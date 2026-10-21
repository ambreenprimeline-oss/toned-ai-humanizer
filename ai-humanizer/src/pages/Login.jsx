import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Auth is removed — the app runs without accounts.
 * Redirect anyone who lands here straight to the editor.
 */
export default function Login() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/editor', { replace: true }); }, [navigate]);
  return null;
}
