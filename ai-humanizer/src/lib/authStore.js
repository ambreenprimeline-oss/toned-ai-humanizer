/**
 * Simple no-op auth shim.
 * The app runs without accounts — all data stays in localStorage.
 * Replaces base44.auth.* calls.
 */

const GUEST = { id: 'local', email: 'guest', full_name: 'You', role: 'user' };

export const authStore = {
  me() {
    return Promise.resolve(GUEST);
  },
  isAuthenticated() {
    return Promise.resolve(true);
  },
  logout(redirectTo) {
    if (redirectTo) window.location.href = typeof redirectTo === 'string' ? redirectTo : '/';
  },
  redirectToLogin() {
    window.location.href = '/login';
  },
};
