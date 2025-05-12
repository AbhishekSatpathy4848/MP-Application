"use client";

import { useEffect, useState, useCallback } from "react";
import {
    DialogContent,
    DialogTitle,
    DialogClose,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { AgentChatUI } from "./modal_chat";
import { useCompany } from "@/hooks/use-company";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, AlertTriangle, Link } from "lucide-react";

export function DialogBox() {
    const { company } = useCompany();
    const [isConnecting, setIsConnecting] = useState(false);
    const [userId, setUpstoxUserId] = useState<string | null>(null);
    const [isClient, setIsClient] = useState(false);
    const [isCheckingAuth, setIsCheckingAuth] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);
    
    // Check authentication status on mount
    useEffect(() => {
        setIsClient(true);
        setIsCheckingAuth(true);
        
        // Check for OAuth code on mount and after redirects
        const checkForAuthCode = () => {
            const urlParams = new URLSearchParams(window.location.search);
            const code = urlParams.get('code');
            
            if (code) {
                // Clear the URL to prevent reusing the code
                window.history.replaceState({}, document.title, window.location.pathname);
                return code;
            }
            return null;
        };
        
        // Check if user is already signed in
        const checkUserSignedIn = async () => {
            const user_id = localStorage.getItem('user_id');
            console.log("Checking user signed in with ID:", user_id);
            if (!user_id) return null;
            
            try {
                const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upstox/user_signed_in?user_id=${user_id}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });

                if (!response.ok) {
                    throw new Error(`API responded with status ${response.status}`);
                }

                const data = await response.json();
                return data["is_signed_in"];
            } catch (error) {
                console.error("Failed to check if user is signed in:", error);
                localStorage.removeItem('user_id'); // Clear invalid token
                return null;
            }
        };

        // Initialize authentication flow
        const initAuth = async () => {
            try {
                setAuthError(null);
                // First check for redirect code
                const code = checkForAuthCode();
                
                if (code) {
                    // Handle authorization code from redirect
                    await handleUpstoxCode(code);
                } else {
                    // Check if user is already signed in
                    const existingUserId = await checkUserSignedIn();
                    console.log("Existing user ID found:", existingUserId);
                    if (existingUserId) {
                        setUpstoxUserId(existingUserId);
                    } else { 
                        localStorage.removeItem('user_id'); // Clear invalid token
                    }
                }
            } catch (error) {
                console.error("Authentication error:", error);
                setAuthError("Failed to authenticate with Upstox. Please try again.");
            } finally {
                setIsCheckingAuth(false);
            }
        };

        initAuth();
    }, []);

    const handleUpstoxCode = async (code: string) => {
        setIsConnecting(true);
        setAuthError(null);
        
        try {
            // Make direct request to Upstox API
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

            if (data.user_id) {
                localStorage.setItem('user_id', data.user_id);
                setUpstoxUserId(data.user_id);
                
                // Save token to backend
                const saveResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upstox/save_access_token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        access_token: data.access_token,
                        user_id: data.user_id,
                    })
                });
                
                if (!saveResponse.ok) {
                    console.warn("Failed to save token to backend, but authentication successful");
                }
            } else {
                throw new Error("No user ID in response");
            }
        } catch (error) {
            console.error("Failed to exchange code for token:", error);
            setAuthError("Failed to connect with Upstox. Please try again.");
            setUpstoxUserId(null);
        } finally {
            setIsConnecting(false);
        }
    };

    // Open auth in new tab
    const connectToUpstox = useCallback(() => {
        const authUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${process.env.NEXT_PUBLIC_UPSTOX_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.NEXT_PUBLIC_UPSTOX_REDIRECT_URI || 'http://localhost:3000/auth')}`;
        
        // Open popup window
        const popup = window.open(authUrl, "UpstoxAuth", "width=600,height=700,left=300,top=200");
        setIsConnecting(true);
        
        // Create a message listener to detect authentication completion
        const messageHandler = (event: MessageEvent) => {
            // Only process messages from our domain
            if (event.origin !== window.location.origin) return;
            
            // Check if the message indicates auth success
            if (event.data && event.data.type === 'UPSTOX_AUTH_SUCCESS' && event.data.userId) {
                setUpstoxUserId(event.data.userId);
                setIsConnecting(false);
                window.removeEventListener('message', messageHandler);
                
                // Close the popup if it's still open
                if (popup && !popup.closed) {
                    popup.close();
                }
            }
        };
        
        window.addEventListener('message', messageHandler);
        
        // Poll for user_id in localStorage every 2 seconds as fallback
        const pollInterval = setInterval(() => {
            const userId = localStorage.getItem('user_id');
            if (userId) {
                clearInterval(pollInterval);
                setUpstoxUserId(userId);
                setIsConnecting(false);
                window.removeEventListener('message', messageHandler);
                
                // Close the popup if it's still open
                if (popup && !popup.closed) {
                    popup.close();
                }
            }
        }, 2000);
        
        // Stop polling after 5 minutes (300000ms)
        setTimeout(() => {
            clearInterval(pollInterval);
            window.removeEventListener('message', messageHandler);
            if (!userId) {
                setIsConnecting(false);
                setAuthError("Connection timed out. Please try again.");
            }
        }, 300000);
    }, [userId]);

    const disconnectUpstox = useCallback(async () => {
        try {
            setIsConnecting(true);
            
            // Call backend to revoke the token
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upstox/logout?user_id=${userId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            
            localStorage.removeItem('user_id');
            setUpstoxUserId(null);
        } catch (error) {
            console.error("Error during logout:", error);
        } finally {
            setIsConnecting(false);
        }
    }, [userId]);

    if (!isClient) {
        return null; // Don't render anything on the server
    }

    return (
        <DialogContent
            className="max-w-7xl w-[90vw] h-[90vh] bg-gradient-to-br from-zinc-900/90 via-zinc-950/95 to-zinc-900/90 text-white !rounded-3xl border border-white/30 shadow-2xl backdrop-blur-2xl overflow-hidden p-0 [&>button]:hidden flex flex-col"
        >
            <VisuallyHidden>
                <DialogTitle>FinGReaT Agent</DialogTitle>
            </VisuallyHidden>
            
            <div className="flex items-center justify-between px-4 pt-6 pb-2">
                <div className="flex items-center">
                    <motion.h1
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                        className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 text-transparent bg-clip-text"
                    >
                        FinGReaT Agent
                    </motion.h1>
                </div>

                <div className="flex items-center gap-3">
                    {/* Only show logout button when user is authenticated */}
                    {userId && (
                                    <motion.button
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        whileHover={{ 
                                            scale: 1.05,
                                            boxShadow: "0 0 15px rgba(69, 21, 84, 0.5)",
                                        }}
                                        whileTap={{ scale: 0.95 }}
                                        transition={{
                                            type: "spring",
                                            stiffness: 400,
                                            damping: 15
                                        }}
                                        className="relative flex items-center gap-1.5 py-1.5 px-3 rounded-full text-xs font-medium
                                            text-white transition-all shadow-md overflow-hidden"
                                        onClick={disconnectUpstox}
                                        disabled={isConnecting}
                                    >
                                        <motion.div 
                                            className="absolute inset-0 bg-gradient-to-r from-[#451554] via-[#6b2080] to-[#451554]"
                                            animate={{
                                                backgroundPosition: ["0% 50%", "100% 50%"],
                                            }}
                                            transition={{
                                                duration: 3,
                                                ease: "linear",
                                                repeat: Infinity,
                                                repeatType: "reverse",
                                            }}
                                            style={{ backgroundSize: "200% 200%" }}
                                        />
                                        <motion.div className="absolute inset-0 bg-[#451554] opacity-80" 
                                            whileHover={{ opacity: 0.5 }}
                                        />
                                        {isConnecting ? (
                                            <motion.svg 
                                                className="relative z-10 -ml-1 mr-2 h-3.5 w-3.5 text-white" 
                                                xmlns="http://www.w3.org/2000/svg" 
                                                fill="none" 
                                                viewBox="0 0 24 24"
                                                animate={{ rotate: 360 }}
                                                transition={{
                                                    duration: 1.5,
                                                    ease: "linear",
                                                    repeat: Infinity
                                                }}
                                            >
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </motion.svg>
                                        ) : (
                                            <motion.svg 
                                                width="14" 
                                                height="14" 
                                                viewBox="0 0 24 24" 
                                                fill="none" 
                                                xmlns="http://www.w3.org/2000/svg" 
                                                className="relative z-10 text-white"
                                                whileHover={{ x: [0, 2, 0] }}
                                                transition={{ duration: 0.5, repeat: Infinity }}
                                            >
                                                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                <path d="M16 17l5-5-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            </motion.svg>
                                        )}
                                        <span className="relative z-10">{isConnecting ? "Disconnecting..." : "Logout"}</span>
                                    </motion.button>
                    )}
                    
                    <DialogClose asChild>
                        <button
                            className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-800/70 hover:bg-zinc-700/80 transition-all border border-zinc-700/40"
                            aria-label="Close"
                        >
                            <X className="w-4 h-4 text-zinc-300 hover:text-white transition-all" />
                        </button>
                    </DialogClose>
                </div>
            </div>
            
            <div className="flex-1 h-[calc(90vh-32px)] overflow-hidden">
                <AnimatePresence mode="wait">
                    {isCheckingAuth ? (
                        <motion.div 
                            key="checking"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col items-center justify-center h-full"
                        >
                            <div className="relative">
                                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#451554] to-[#6b2080] opacity-20 animate-pulse"></div>
                                <Loader2 className="h-10 w-10 text-[#451554] animate-spin mb-4 relative z-10" />
                            </div>
                            <p className="text-zinc-300 text-sm mt-3">Checking authentication...</p>
                        </motion.div>
                    ) : userId ? (
                        <motion.div
                            key="chat"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="h-full"
                        >
                            <AgentChatUI companyTicker={company} />
                        </motion.div>
                    ) : (
                        <motion.div 
                            key="auth-required"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="flex flex-col items-center justify-center h-full px-8 text-center"
                        >
                            {authError && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex items-center gap-2 bg-red-950/30 text-red-300 text-sm py-2 px-3 rounded-lg mb-6 border border-red-800/30"
                                >
                                    <AlertTriangle className="h-4 w-4" />
                                    <span>{authError}</span>
                                </motion.div>
                            )}
                            
                            <div className="relative mb-8">
                                <div className="absolute inset-0 bg-gradient-to-r from-[#451554] via-[#6b2080] to-[#451554] opacity-15 rounded-2xl animate-pulse"></div>
                                <img 
                                    src="Upstox.avif" 
                                    alt="Upstox logo" 
                                    className="h-25 border border-zinc-700 rounded-2xl shadow-lg relative z-10"
                                />
                            </div>
                            
                            <h3 className="text-xl font-bold text-white mb-2">Connect to your Upstox Account</h3>
                            
                            <p className="text-zinc-300 text-sm mb-10 max-w-md">
                                To use the FinGReaT Agent, you need to connect your Upstox account first. This allows you to analyze company market movements, financial performance, background information or to execute trades directly through our platform.
                            </p>
                            
                            <motion.div className="relative">
                                <motion.div
                                    className="absolute inset-0 bg-gradient-to-r from-[#451554] via-[#6b2080] to-[#451554] rounded-2xl opacity-40"
                                    animate={{
                                        backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                                    }}
                                    transition={{
                                        duration: 5,
                                        ease: "linear",
                                        repeat: Infinity,
                                    }}
                                    style={{ backgroundSize: "200% 200%" }}
                                />
                                <motion.button
                                    whileHover={{ 
                                        scale: 1.05,
                                        boxShadow: "0 0 20px rgba(90, 27, 109, 0.6)",
                                    }}
                                    whileTap={{ scale: 0.98 }}
                                    className="relative z-10 bg-[#451554]/80 py-3 px-8 rounded-2xl text-white font-medium shadow-lg flex items-center gap-3 border border-[#451554]/30"
                                    onClick={connectToUpstox}
                                    disabled={isConnecting}
                                >
                                    {isConnecting ? (
                                        <>
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                            <span>Connecting...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Link className="h-5 w-5" />
                                            <span>Connect with Upstox</span>
                                        </>
                                    )}
                                </motion.button>
                                
                                {/* Animated glow effect */}
                                <motion.div 
                                    className="absolute inset-0 rounded-2xl"
                                    animate={{
                                        boxShadow: [
                                            "0 0 0px rgba(90, 27, 109, 0.0)",
                                            "0 0 20px rgba(90, 27, 109, 0.4)",
                                            "0 0 0px rgba(90, 27, 109, 0.0)",
                                        ],
                                    }}
                                    transition={{
                                        duration: 2,
                                        repeat: Infinity,
                                        repeatType: "reverse",
                                    }}
                                />
                            </motion.div>
                            
                            <p className="text-zinc-500 text-xs mt-6">
                                By connecting, you agree to Upstox's Terms of Service and Privacy Policy
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </DialogContent>
    );
}