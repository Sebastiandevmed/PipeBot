import { supabase } from '../services/supabase.js';

export async function getCustomerByPhone(phone) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('phone_number', phone)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateCustomer(phone, fields) {
  const allowed = ['name', 'business_name', 'address', 'neighborhood', 'preferred_payment_method'];
  const patch = Object.fromEntries(
    Object.entries(fields).filter(([k, v]) => allowed.includes(k) && v != null && v !== '')
  );
  if (Object.keys(patch).length === 0) return await getCustomerByPhone(phone);

  const { data, error } = await supabase
    .from('customers')
    .update(patch)
    .eq('phone_number', phone)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Returns true once name, business_name, address and neighborhood are all set.
export function isProfileComplete(customer) {
  if (!customer) return false;
  return Boolean(customer.name && customer.business_name && customer.address && customer.neighborhood);
}
