"use client";

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function Page() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing your authentication...');

  useEffect(() => {
    async function handleAuthCallback() {
      try {
        // Get the authorization code from URL
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');

        if (!code) {
          setStatus('error');
          setMessage('No authorization code found in URL.');
          return;
        }

        // Exchange the code for a token
        const response = await fetch('https://api.upstox.com/v2/login/authorization/token', {
          method: 'POST',
          body: new URLSearchParams({
            code: code,
            client_id: process.env.NEXT_PUBLIC_UPSTOX_CLIENT_ID || '',
            client_secret: process.env.NEXT_PUBLIC_UPSTOX_CLIENT_SECRET || '',
            redirect_uri: process.env.NEXT_PUBLIC_UPSTOX_REDIRECT_URI || 'http://localhost:3000/auth',
            grant_type: 'authorization_code'
          }),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();

        if (!data.user_id) {
          throw new Error('No user ID in response');
        }

        // Store the user ID in localStorage
        localStorage.setItem('user_id', data.user_id);

        // Save token to backend
        let r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upstox/save_access_token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            access_token: data.access_token,
            user_id: data.user_id,
          })
        });

        console.log('Response from backend:', r.json());

        // Send a message to the parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'UPSTOX_AUTH_SUCCESS',
            userId: data.user_id
          }, window.location.origin);
        }

        setStatus('success');
        setMessage('Authentication successful! You can close this window.');
        
        // Auto-close the window after 1.5 seconds
        setTimeout(() => {
          window.close();
        }, 10000);
        
      } catch (error) {
        console.error('Authentication error:', error);
        setStatus('error');
        setMessage('Failed to authenticate. Please try again.');
      }
    }

    handleAuthCallback();
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-zinc-900 text-white">
      <div className="max-w-md p-8 rounded-xl bg-zinc-800/70 border border-zinc-700 shadow-xl text-center">
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 text-[#451554] animate-spin" />
            <h1 className="text-xl font-semibold">Authenticating...</h1>
            <p className="text-zinc-300">Please wait while we complete your Upstox authentication.</p>
          </div>
        )}
        
        {status === 'success' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 6L9 17L4 12" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-green-400">Success!</h1>
            <p className="text-zinc-300">{message}</p>
            <p className="text-zinc-400 text-sm mt-2">This window will close automatically...</p>
          </div>
        )}
        
        {status === 'error' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6l12 12" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-red-400">Error</h1>
            <p className="text-zinc-300">{message}</p>
            <button 
              onClick={() => window.close()} 
              className="mt-4 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors"
            >
              Close Window
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
