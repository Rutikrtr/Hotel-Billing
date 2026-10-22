-- Hotel name and address are set by the super admin (sa_update_hotel); owners can still change the phone, GST and switches.
revoke update (hotel_name, hotel_address) on public.restaurants from authenticated;
