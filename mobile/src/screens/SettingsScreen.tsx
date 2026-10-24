import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { useAppDispatch, useAppSelector } from '../store';
import { loginName, signOut } from '../store/auth';
import { hasPending } from '../store/cart';
import { Button, Card, T } from '../ui/kit';
import { C } from '../ui/theme';
import type { Stack } from '../Root';

const ROLE = { owner: 'Owner', manager: 'Manager', staff: 'Waiter' } as const;

export default function SettingsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const dispatch = useAppDispatch();
  const { email, account } = useAppSelector((s) => s.auth);
  const settings = useAppSelector((s) => s.data.settings);
  const printer = useAppSelector((s) => s.printer);
  const carts = useAppSelector((s) => s.cart);
  const unsaved = Object.values(carts).filter(hasPending).length;

  const out = () => {
    const go = () => dispatch(signOut());
    if (unsaved) Alert.alert('Unsaved orders', `${unsaved} order(s) on this phone are not saved yet. Sign out anyway?`, [{ text: 'Cancel' }, { text: 'Sign Out', style: 'destructive', onPress: go }]);
    else go();
  };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 30 }}>
      <T w="heavy" style={{ fontSize: 24, marginTop: 6 }}>Settings</T>
      <Card>
        <T w="heavy" style={{ fontSize: 17 }}>{loginName(email)}</T>
        <T style={{ color: C.muted }}>{ROLE[account?.role ?? 'staff']} · {settings?.hotel_name ?? account?.hotel}</T>
        {settings?.hotel_phone ? <T style={{ color: C.muted, marginTop: 4 }}>Hotel phone {settings.hotel_phone}</T> : null}
      </Card>
      <Card style={{ gap: 8 }}>
        <T w="heavy" style={{ fontSize: 16 }}>Printer</T>
        <T style={{ color: C.muted }}>{printer.bill ? `Bills: ${printer.bill.name}${printer.separateKitchen && printer.kitchen ? ` · Kitchen: ${printer.kitchen.name}` : ''}` : 'No printer set up on this phone'}</T>
        <Button kind="secondary" title="Printer Setup" onPress={() => nav.navigate('Printer')} />
      </Card>
      {account?.role === 'owner' ? (
        <Card style={{ gap: 8 }}>
          <T w="heavy" style={{ fontSize: 16 }}>Menu, analytics and staff</T>
          <T style={{ color: C.muted }}>Edit the menu, see analytics and manage staff logins in the Master Bill web app.</T>
          <Button kind="secondary" title="Open Web App" onPress={() => Linking.openURL('https://hotel-billing-v1.pages.dev')} />
        </Card>
      ) : null}
      <Button kind="danger" title="Sign Out" onPress={out} />
      <T style={{ textAlign: 'center', color: C.muted, fontSize: 12 }}>Master Bill · Techyverve Solution Limited</T>
    </ScrollView>
  );
}
