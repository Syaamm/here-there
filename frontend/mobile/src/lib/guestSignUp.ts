import { useRouter } from 'expo-router';
import { useMe } from './auth';

/**
 * A guest ("Explore") who taps Sign up / Create account: the guest session is closed (the welcome page is under it, so Back returns
 * there) and the Create account page opens, the same way verifyGate does it.
 */
export function useGuestSignUp() {
  const { logout } = useMe();
  const router = useRouter();
  return () => {
    logout();
    setTimeout(() => router.push('/register' as never), 150);
  };
}
