-- Hotel phone is set by the super admin (sa_update_hotel), like the name and address.
revoke update (hotel_phone) on public.restaurants from authenticated;
