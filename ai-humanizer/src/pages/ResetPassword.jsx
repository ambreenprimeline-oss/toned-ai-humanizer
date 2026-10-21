import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ResetPassword() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/editor', { replace: true }); }, [navigate]);
  return null;
}
