// Tool registry. Each tool has:
//   - definition: JSON-schema fed to the LLM (Groq tool-calling format)
//   - run(args, ctx): server-side executor; returns a JSON-serializable result
// ctx = { phone, customer, conversation }

import { CATALOG, MIN_PACKAGES } from './catalog.js';
import { businessClock, computeDeliveryDate, deliveryWindowLabel } from './business.js';
import { getCustomerByPhone, updateCustomer, isProfileComplete } from './customer.js';
import {
  getDraft, setDraftItems, setDraftField, totalsFor, placeOrder, clearDraft
} from './order.js';
import { requestHandoff } from './handoff.js';

const tools = {
  get_catalog: {
    definition: {
      type: 'function',
      function: {
        name: 'get_catalog',
        description: 'Returns the full product catalog (names, categories, sizes, COP prices) and the minimum-order rule. Use when the customer asks what is available.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async run() {
      return { products: CATALOG, minimum_packages: MIN_PACKAGES };
    }
  },

  get_business_status: {
    definition: {
      type: 'function',
      function: {
        name: 'get_business_status',
        description: 'Returns current Colombia time, whether the business is open, whether the same-day delivery cutoff (09:00) has passed, and the projected delivery date for an order placed now.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async run() {
      const clock = businessClock();
      const delivery = computeDeliveryDate();
      return {
        within_hours: clock.withinHours,
        is_weekday: clock.isWeekday,
        before_cutoff: clock.beforeCutoff,
        window: deliveryWindowLabel(),
        delivery_date: delivery.date,
        delivery_label: delivery.label,
        same_day: delivery.sameDay
      };
    }
  },

  get_customer: {
    definition: {
      type: 'function',
      function: {
        name: 'get_customer',
        description: 'Look up the customer profile for the current phone. Returns whether the profile is complete (has name, business, address, neighborhood).',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async run(_args, ctx) {
      const customer = await getCustomerByPhone(ctx.phone);
      return { customer, profile_complete: isProfileComplete(customer) };
    }
  },

  update_customer: {
    definition: {
      type: 'function',
      function: {
        name: 'update_customer',
        description: 'Save or update customer data. Only call once you have confirmed the values with the customer.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full personal name' },
            business_name: { type: 'string' },
            address: { type: 'string' },
            neighborhood: { type: 'string' },
            preferred_payment_method: { type: 'string', enum: ['efectivo', 'nequi', 'transferencia'] }
          },
          additionalProperties: false
        }
      }
    },
    async run(args, ctx) {
      const customer = await updateCustomer(ctx.phone, args);
      return { customer, profile_complete: isProfileComplete(customer) };
    }
  },

  set_order_items: {
    definition: {
      type: 'function',
      function: {
        name: 'set_order_items',
        description: 'Replace the draft order with this list of items. Each item must use the exact product name from the catalog. Returns running totals and any unknown product names that were skipped.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1 }
                },
                required: ['name', 'quantity'],
                additionalProperties: false
              }
            }
          },
          required: ['items'],
          additionalProperties: false
        }
      }
    },
    async run(args, ctx) {
      const { draft, unknown, totals } = await setDraftItems(ctx.phone, args.items);
      return { items: draft.items, totals, unknown_products: unknown };
    }
  },

  set_order_details: {
    definition: {
      type: 'function',
      function: {
        name: 'set_order_details',
        description: 'Set delivery and payment fields on the draft order. payment_proof_url is set automatically when the customer sends an image — only call this with payment_proof_url if you have just received one.',
        parameters: {
          type: 'object',
          properties: {
            payment_method: { type: 'string', enum: ['efectivo', 'nequi', 'transferencia'] },
            delivery_address: { type: 'string' },
            delivery_neighborhood: { type: 'string' }
          },
          additionalProperties: false
        }
      }
    },
    async run(args, ctx) {
      const draft = await setDraftField(ctx.phone, args);
      return { draft, totals: totalsFor(draft) };
    }
  },

  get_draft_order: {
    definition: {
      type: 'function',
      function: {
        name: 'get_draft_order',
        description: 'Returns the current draft order: items, totals, payment method, delivery info, and whether minimum is met.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async run(_args, ctx) {
      const draft = await getDraft(ctx.phone);
      return { draft, totals: totalsFor(draft) };
    }
  },

  place_order: {
    definition: {
      type: 'function',
      function: {
        name: 'place_order',
        description: 'Persist the draft as a real order. Only call after the customer has explicitly confirmed. Fails if minimum is not met, payment method is missing, or digital payment lacks a proof image.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async run(_args, ctx) {
      try {
        const { order, delivery } = await placeOrder({
          phone: ctx.phone,
          customer: ctx.customer,
          conversation: ctx.conversation
        });
        return { ok: true, order_number: order.order_number, delivery };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  cancel_draft: {
    definition: {
      type: 'function',
      function: {
        name: 'cancel_draft',
        description: 'Discard the current draft order. Use when the customer says "no", "cancelar" before final confirmation.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async run(_args, ctx) {
      await clearDraft(ctx.phone);
      return { ok: true };
    }
  },

  request_handoff: {
    definition: {
      type: 'function',
      function: {
        name: 'request_handoff',
        description: 'Hand the conversation off to a human agent. Call ONCE for: customer requests human, complaint, frustration/anger, tracking request, modification of past order, 2 consecutive misunderstandings, off-topic loops. After this returns ok, send ONE short transition message and then stop responding.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              enum: [
                'customer_request', 'bot_confused', 'customer_frustrated',
                'complaint', 'tracking_request', 'modification_request',
                'out_of_scope', 'pricing_question'
              ]
            }
          },
          required: ['reason'],
          additionalProperties: false
        }
      }
    },
    async run(args, ctx) {
      const conv = await requestHandoff(ctx.conversation.id, args.reason);
      return { ok: true, status: conv.status, reason: conv.handoff_reason };
    }
  }
};

export const TOOL_DEFINITIONS = Object.values(tools).map((t) => t.definition);

export async function runTool(name, args, ctx) {
  const tool = tools[name];
  if (!tool) return { error: `unknown_tool:${name}` };
  try {
    return await tool.run(args ?? {}, ctx);
  } catch (err) {
    console.error(`tool ${name} error:`, err);
    return { error: err.message ?? String(err) };
  }
}
