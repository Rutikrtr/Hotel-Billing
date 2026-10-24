import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useAppDispatch, useAppSelector } from '../store';
import { signIn } from '../store/auth';
import { Button, Card, T } from '../ui/kit';
import { Logo } from '../ui/Logo';
import { C, F } from '../ui/theme';

export default function LoginScreen() {
  const dispatch = useAppDispatch();
  const { busy, error } = useAppSelector((s) => s.auth);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const submit = () => { if (login.trim() && password) dispatch(signIn({ login, password })); };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 22 }}>
          <Logo size={72} />
          <T w="heavy" style={st.title}>Master Bill</T>
          <T style={{ color: C.muted }}>by Techyverve</T>
        </View>
        <Card style={{ padding: 18 }}>
          <T w="bold" style={st.label}>Email or Login ID</T>
          <TextInput
            value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} placeholder="ramesh or you@hotel.com"
            placeholderTextColor="#A39589" style={st.input} returnKeyType="next" accessibilityLabel="Email or Login ID"
          />
          <T w="bold" style={[st.label, { marginTop: 14 }]}>Password</T>
          <View>
            <TextInput
              value={password} onChangeText={setPassword} secureTextEntry={!show} style={[st.input, { paddingRight: 70 }]}
              returnKeyType="go" onSubmitEditing={submit} accessibilityLabel="Password"
            />
            <Pressable onPress={() => setShow(!show)} style={st.show} hitSlop={8} accessibilityRole="button">
              <T w="bold" style={{ color: C.accent }}>{show ? 'Hide' : 'Show'}</T>
            </Pressable>
          </View>
          {error ? <T style={st.error}>{error}</T> : null}
          <Button title="Sign In" onPress={submit} busy={busy} disabled={!login.trim() || !password} style={{ marginTop: 18 }} />
        </Card>
        <T style={st.foot}>No login? Ask your hotel owner for a Login ID, or contact Techyverve.</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 28, marginTop: 12, letterSpacing: -0.5 },
  label: { fontSize: 13, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, fontFamily: F.regular, color: C.text, backgroundColor: C.surface },
  show: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  error: { marginTop: 12, color: C.danger, fontSize: 13.5 },
  foot: { textAlign: 'center', color: C.muted, marginTop: 18, fontSize: 13 },
});
