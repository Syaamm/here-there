import { Stack } from 'expo-router';

// Signed-out people land on the welcome page first (screens are otherwise ordered by name, which would open login).
export const unstable_settings = { anchor: 'welcome', initialRouteName: 'welcome' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
