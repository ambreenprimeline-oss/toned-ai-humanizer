import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// MCP OAuth consent is not used in this deployment.
export default function OAuthConsent() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/', { replace: true }); }, [navigate]);
  return null;
}
