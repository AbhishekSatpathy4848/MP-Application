"use client";

import { useState, useEffect, useRef } from "react";
import { Trash2, Loader2, Bot, User, ArrowUpIcon, AlertCircle, X, Mic } from "lucide-react";
import { Button } from "./ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { AutoResizeTextarea } from "@/components/autoresize-textarea";
import { convertSpeechToText, generateSpeech } from "@/lib/tts_and_stt_llm_calls";

interface Message {
  role: "user" | "agent";
  content: string;
  id: string; // Add unique ID for animations
}

interface ChatUIProps {
  companyTicker?: string;
}

// Define interfaces for speech object
interface SpeechObject {
  audio: HTMLAudioElement;
  play: () => Promise<void>;
  stop: () => void;
  cleanup: () => void;
}

export function AgentChatUI({ companyTicker }: ChatUIProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isClient, setIsClient] = useState(false); // Fix hydration issues
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const voiceConversationRef = useRef<HTMLDivElement>(null);
  const [storedContext, setStoredContext] = useState<{ movement_prediction: string, explanation: string, news: string } | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioData, setAudioData] = useState<number[]>([]);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcribedText, setTranscribedText] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<string>('');
  const [silenceTimer, setSilenceTimer] = useState<NodeJS.Timeout | null>(null);
  const [silenceDetected, setSilenceDetected] = useState(false);
  const silenceThreshold = useRef<number>(15); // Silence threshold value
  const silenceDuration = useRef<number>(1500); // Duration in ms to consider silence
  const lastAudioLevel = useRef<number>(0);
  const silenceDetectionRef = useRef<boolean>(false); // Track if silence detection is active
  const checkSilenceLoopRef = useRef<Function | null>(null); // Store the checkSilenceLoop function

  // Audio refs for voice recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechObject | null>(null);
  const timeRef = useRef<number>(0);
  const isActiveRef = useRef<boolean>(false);
  const [isActive, setIsActive] = useState<boolean>(false);

  // Fix hydration issues by confirming we're on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Update active state when recording or speaking changes
  useEffect(() => {
    setIsActive(isRecording || isSpeaking);
  }, [isRecording, isSpeaking]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    const fetchStoredMessages = async () => {
      if (!companyTicker) return;
      
      const storedMessages = localStorage.getItem(companyTicker);
      if (storedMessages) {
        try {
          const parsedMessages = JSON.parse(storedMessages);
          setStoredContext({
            "movement_prediction": parsedMessages[13]?.content?.result || "",
            "explanation": parsedMessages[13]?.content?.explanation || "",
            "news": parsedMessages[0]?.content || ""
          });
        } catch (error) {
          console.error("Error parsing stored messages:", error);
        }
      }
    };

    if (isClient) {
      fetchStoredMessages();
    }
  }, [companyTicker, isClient]);

  useEffect(() => {
    const fetchConversations = async () => {
      if (!companyTicker) return;
      
      try {
        setIsFetching(true);
        const response = await fetch(process.env.NEXT_PUBLIC_API_URL + `/${companyTicker}/agents/master_agent/conversations`);
        if (response.ok) {
          const data = await response.json();
          
          if (Array.isArray(data)) {
            const formattedMessages: Message[] = [];
            data.forEach((item: any, index: number) => {
              if (item.user) {
                formattedMessages.push({
                  role: "user",
                  content: item.user,
                  id: `user-${index}`
                });
              }
              
              if (item.assistant) {
                formattedMessages.push({
                  role: "agent",
                  content: item.assistant,
                  id: `agent-${index}`
                });
              }
            });
            
            setMessages(formattedMessages);
          } else {
            console.error("Unexpected data format:", data);
          }
        } else {
          console.error("Failed to fetch conversations");
        }
      } catch (error) {
        console.error("Error fetching conversations:", error);
      } finally {
        setIsFetching(false);
      }
    };
  
    if (companyTicker && isClient) {
      fetchConversations();
    }
  }, [companyTicker, isClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showVoiceModal]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clean up audio resources on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (animationFrameRef.current && animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (speechRef.current) {
        speechRef.current.cleanup();
      }
      cleanupAudio();
    };
  }, []);

  // Setup voice visualizer when modal is shown
  useEffect(() => {
    if (showVoiceModal) {
      setupAudio();
    } else {
      cleanupAudio();
    }
  }, [showVoiceModal]);

  // Track isRecording state changes to start/stop silence detection
  useEffect(() => {
    // Start silence detection when recording begins
    if (isRecording && checkSilenceLoopRef.current && !silenceDetectionRef.current) {
      console.log("Starting silence detection loop");
      silenceDetectionRef.current = true;
      (checkSilenceLoopRef.current as Function)();
    } else if (!isRecording) {
      // Stop silence detection when recording stops
      silenceDetectionRef.current = false;
    }
  }, [isRecording]);

  const handleSendMessage = async (content?: string) => {
    const messageToSend = content || inputValue;
    if (!messageToSend.trim()) return;

    const userMessage: Message = {
      role: "user",
      content: messageToSend,
      id: `user-${Date.now()}`
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setTranscribedText("");
    setIsLoading(true);

    console.log("Sending message to agent:", userMessage.content);
    const url = process.env.NEXT_PUBLIC_API_URL + `/${companyTicker}/agents/master_agent`;
    console.log("API URL:", url);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company: companyTicker || "",
          query: userMessage.content,
          movement_prediction: storedContext?.movement_prediction || "",
          explanation: storedContext?.explanation || "",
          news: storedContext?.news || ""
        }),
      });

      if (response.ok) {
        const data = await response.text();
        const agentMessage: Message = {
          role: "agent",
          content: data || "No response from agent",
          id: `agent-${Date.now()}`
        };
        setMessages((prev) => [...prev, agentMessage]);
        setAiResponse(data);
        
        // If voice modal is open, play response as speech
        if (showVoiceModal) {
          playSpeech(data);
        }
      } else {
        throw new Error("Failed to get response from agent");
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        role: "agent",
        content: "Sorry, there was an error processing your request.",
        id: `error-${Date.now()}`
      };
      setMessages((prev) => [...prev, errorMessage]);
      setAiResponse("Sorry, there was an error processing your request.");
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  };

  const handleClearConversation = async () => {
    setShowConfirmDialog(true);
  };

  const confirmClear = async () => {
    setShowConfirmDialog(false);
    
    try {
      const response = await fetch(process.env.NEXT_PUBLIC_API_URL + `/${companyTicker}/agents/master_agent/conversations`, {
        method: "DELETE",
      });

      if (response.ok) {
        setMessages([]);
        setTranscribedText("");
        setAiResponse("");
      } else {
        console.error("Failed to clear conversations");
      }
    } catch (error) {
      console.error("Error clearing conversations:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Voice assistant functions
  const setupAudio = async () => {
    try {
      // Check if navigator.mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("Media devices API not available in this browser");
        alert("Voice recording is not supported in this browser. Please try using a modern browser like Chrome, Firefox, or Safari.");
        return;
      }
      
      // Request access to the microphone with proper error handling
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        .catch(err => {
          console.error("Error accessing microphone:", err.message);
          alert("Could not access your microphone. Please check your permissions and try again.");
          throw err;
        });
        
      streamRef.current = stream;
      
      // Create a new audio context
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) {
        console.error("AudioContext not supported in this browser");
        alert("Your browser doesn't support audio processing. Please try a different browser.");
        return;
      }
      
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Create an analyser node with higher FFT size for better resolution
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024; // Increased from 256 for more frequency bins
      analyser.smoothingTimeConstant = 0.7; // Add smoothing for more fluid animation
      analyserRef.current = analyser;

      // Create a source from the microphone stream
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Prepare data array to receive the audio data
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      // Start the animation loop
      timeRef.current = Date.now();
      draw();
      
      // Setup the media recorder for speech recording
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        try {
          setIsProcessing(true);
          
          const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
          recordedChunksRef.current = [];
          
          // Call the speech-to-text conversion function
          const text = await convertSpeechToText(audioBlob);
          setTranscribedText(text);
          
          // Send message to the agent
          setIsProcessing(false);
          
          // Send transcribed text to chat
          if (text) {
            await handleSendMessage(text);
          }
        } catch (error) {
          console.error('Error processing speech:', error);
          setIsProcessing(false);
        }
      };

      // Define the checkSilenceLoop function and store in ref
      const checkSilenceLoop = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        
        // Only proceed if we're actively recording and silence detection is active
        if (isRecording && silenceDetectionRef.current) {
          analyserRef.current.getByteFrequencyData(dataArrayRef.current);
          
          // Calculate average audio level
          let sum = 0;
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            sum += dataArrayRef.current[i];
          }
          const average = sum / dataArrayRef.current.length;
          lastAudioLevel.current = average;
          
          console.log("Audio level:", average, "Threshold:", silenceThreshold.current);
          
          // Check for silence
          if (average < silenceThreshold.current) {
            if (!silenceDetected) {
              console.log("Silence detected, starting timer");
              setSilenceDetected(true);
              if (silenceTimer) clearTimeout(silenceTimer);
              setSilenceTimer(setTimeout(() => {
                console.log("Silence timer triggered, stopping recording");
                if (isRecording) {
                  stopRecording(); // Automatically stop recording after silence
                }
              }, silenceDuration.current));
            }
          } else {
            if (silenceDetected) {
              console.log("Sound detected, clearing timer");
              setSilenceDetected(false);
              if (silenceTimer) {
                clearTimeout(silenceTimer);
                setSilenceTimer(null);
              }
            }
          }
        }
        
        // Continue checking in the animation frame only if silence detection is active
        if (silenceDetectionRef.current) {
          requestAnimationFrame(checkSilenceLoop);
        }
      };
      
      // Store the function for later use
      checkSilenceLoopRef.current = checkSilenceLoop;
      
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const playSpeech = async (text: string): Promise<void> => {
    try {
      // Clean up previous audio if it exists
      if (speechRef.current) {
        speechRef.current.cleanup();
      }
      
      setIsSpeaking(true); // This will trigger the isActive state to true
      
      // Generate and play speech
      const speech = await generateSpeech(text, 'coral');
      speechRef.current = speech;
      
      // Connect speech to analyzer to visualize the AI response
      if (audioContextRef.current && analyserRef.current && speech.audio) {
        // Create a new audio context if needed
        if (audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || window.AudioContext)();
          analyserRef.current = audioContextRef.current.createAnalyser();
          analyserRef.current.fftSize = 1024;
          analyserRef.current.smoothingTimeConstant = 0.7;
          
          const bufferLength = analyserRef.current.frequencyBinCount;
          dataArrayRef.current = new Uint8Array(bufferLength);
        }
        
        const speechSource = audioContextRef.current.createMediaElementSource(speech.audio);
        speechSource.connect(analyserRef.current);
        speechSource.connect(audioContextRef.current.destination); // Connect to output for playback
      }
      
      await speech.play();
      
      // When speech ends
      speech.audio.onended = () => {
        setIsSpeaking(false);
      };
    } catch (error) {
      console.error('Error generating speech:', error);
      setIsSpeaking(false);
    }
  };

  const toggleRecording = () => {
    if (isProcessing || isSpeaking) return; // Prevent toggling while processing
    
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'recording') {
      recordedChunksRef.current = [];
      mediaRecorderRef.current.start();
      setIsRecording(true);
      
      // Reset silence detection state when starting recording
      setSilenceDetected(false);
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        setSilenceTimer(null);
      }
      
      // Set a lower threshold during active recording (adjust as needed)
      silenceThreshold.current = 10;
      silenceDuration.current = 1500; // 1.5 seconds of silence
      
      // Explicitly start silence detection loop if it exists
      if (checkSilenceLoopRef.current && !silenceDetectionRef.current) {
        console.log("Manually starting silence detection from startRecording");
        silenceDetectionRef.current = true;
        (checkSilenceLoopRef.current as Function)();
      }
    }
  };
  
  const stopRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop silence detection
      silenceDetectionRef.current = false;
      console.log("Stopping recording and silence detection");
    }
  };
  
  const stopSpeaking = (): void => {
    if (speechRef.current) {
      speechRef.current.stop();
      setIsSpeaking(false);
    }
  };

  const cleanupAudio = (): void => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(err => console.error("Error closing audio context:", err));
      audioContextRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (speechRef.current) {
      speechRef.current.cleanup();
      speechRef.current = null;
    }
    
    // Also stop silence detection
    silenceDetectionRef.current = false;
    
    setIsRecording(false);
    setIsProcessing(false);
    setIsSpeaking(false);
    setIsActive(false);
  };

  function draw(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;
    
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (!analyser || !dataArray) return;

    const bufferLength = analyser.frequencyBinCount;

    const drawVisualizer = (): void => {
      animationFrameRef.current = requestAnimationFrame(drawVisualizer);

      // Calculate time elapsed for animations
      const now = Date.now();
      const elapsed = now - timeRef.current;
      timeRef.current = now;

      analyser.getByteFrequencyData(dataArray);

      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

      const currentlyActive = isActiveRef.current;

      // Background glow effect
      if (currentlyActive) {
        canvasCtx.shadowBlur = 10;
        canvasCtx.shadowColor = 'rgba(255, 255, 255, 0.5)';
      } else {
        canvasCtx.shadowBlur = 0;
      }

      const barCount = 64; // Number of bars
      const padding = 4; // Padding between bars
      const totalPadding = padding * (barCount - 1);
      const barWidth = (canvas.width - totalPadding) / barCount;
      const centerY = canvas.height / 2;
      const cornerRadius = Math.min(10, barWidth / 2); // Adaptive corner radius
      const minBarHeight = canvas.height * 0.08; // Minimum bar height

      // Use more distinct colors for active/inactive states
      canvasCtx.fillStyle = currentlyActive ? 'rgb(255, 255, 255)' : 'rgb(80, 80, 80)';

      // Calculate an activity multiplier based on overall audio energy
      let totalEnergy = 0;
      for (let i = 0; i < bufferLength; i++) {
        totalEnergy += dataArray[i];
      }
      const avgEnergy = totalEnergy / bufferLength;
      const activityMultiplier = currentlyActive ?
          1 + (avgEnergy / 128) * 0.4 : // Boost when active
          0.2; // Lower when inactive

      for (let i = 0; i < barCount; i++) {
        // Apply sine wave distribution (0 to π) for bar positions
        const positionRatio = i / (barCount - 1); // 0 to 1
        const sineDistribution = Math.sin(positionRatio * Math.PI); // Sine wave from 0 to π (0 to 1 to 0)

        // Get frequency bin index with emphasis on mid-range frequencies
        const normIndex = i / barCount;

        // Enhanced frequency mapping that emphasizes the vocal range
        let freqIndex;
        if (normIndex < 0.8) {
          // First 60% of bars map to lower-mid frequencies (emphasize voice frequencies)
          freqIndex = Math.floor((normIndex / 0.6) * bufferLength * 0.5);
        } else {
          // Last 40% of bars map to higher frequencies
          freqIndex = Math.floor(bufferLength * 0.5 + ((normIndex - 0.6) / 0.4) * bufferLength * 0.5);
        }

        freqIndex = Math.min(freqIndex, bufferLength - 1);

        // Get the magnitude value from the frequency data
        let magnitude = dataArray[freqIndex];

        // Apply frequency-dependent scaling to emphasize middle frequencies (voice range)
        if (normIndex > 0.4 && normIndex < 0.9) {
          // Boost mid-range frequencies (voice frequencies ~300-3000 Hz)
          magnitude = magnitude * 1.5;
        }

        // Apply sine wave amplitude modulation
        magnitude *= sineDistribution;

        // Cap at 255 to prevent overflow
        magnitude = Math.min(magnitude, 255);

        // Add gentle bounce animation based on position and time
        const bouncePhase = (i / barCount) * Math.PI * 6;
        const bounceSpeed = 0.003; // Speed of bounce

        // More dynamic bounce amounts based on bar position
        const bounceAmount = currentlyActive ?
            8 + Math.sin(i * 0.4) * 4 : // More dramatic when active
            3 + Math.sin(i * 0.4) * 2;  // Subtle when inactive

        // Calculate bounce offset - stronger when sound is low
        const soundIntensity = magnitude / 255;
        const bounceInfluence = Math.max(0, 0.6 - soundIntensity);
        const bounceOffset = Math.sin(now * bounceSpeed + bouncePhase) * bounceAmount * bounceInfluence;

        // Calculate bar height with a minimum height guarantee and add bounce
        const maxBarHeight = canvas.height * 0.7;
        let dynamicHeight;

        // Apply sine wave distribution for height variation
        dynamicHeight = Math.sqrt(magnitude / 255) * maxBarHeight * 1.2 * sineDistribution;

        // Apply activity multiplier to make bars more responsive
        dynamicHeight *= activityMultiplier;

        // Add bounce effect
        const barHeight = Math.max(minBarHeight * sineDistribution, dynamicHeight) + bounceOffset;

        const x = i * (barWidth + padding);
        const y = centerY - barHeight / 2;

        // Draw rounded rectangle
        canvasCtx.beginPath();
        if ('roundRect' in canvasCtx) {
          // TypeScript doesn't know about roundRect yet, so we need to use any
          (canvasCtx as any).roundRect(x, y, barWidth, barHeight, cornerRadius);
        } else {
          drawRoundedRect(canvasCtx, x, y, barWidth, barHeight, cornerRadius);
        }
        canvasCtx.fill();
      }
    };

    drawVisualizer();
  }

  // Fallback function for drawing rounded rectangles
  function drawRoundedRect(
      ctx: CanvasRenderingContext2D, 
      x: number, 
      y: number, 
      width: number, 
      height: number, 
      radius: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // Calculate a color gradient based on activity level
  const getGradient = () => {
    if (isActive) {
      return 'from-blue-500 to-purple-500'; // More vibrant when active
    }
    return 'from-gray-700 to-gray-800'; // More subtle when inactive
  };

  // Toggle voice modal
  const openVoiceModal = () => {
    setShowVoiceModal(true);
  };

  const closeVoiceModal = () => {
    setShowVoiceModal(false);
  };

  // Don't render content until client-side hydration is complete
  if (!isClient) {
    return null;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-b from-zinc-900/80 to-zinc-950/80 backdrop-blur-md rounded-b-[2.5rem] border border-white/5"> 

      {/* Messages Area - Explicitly set to fill available space while allowing scrolling */}
      <div 
        ref={messageContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.05),transparent_60%)] scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
        style={{ height: "calc(100% - 130px)" }} // Subtract header + input area height
      >
        {isFetching ? (
          <div className="flex flex-col justify-center items-center h-full space-y-4">
            <div className="relative">
              {/* Modern pulsating loading animation */}
              <div className="absolute inset-0 rounded-full animate-ping bg-blue-500 opacity-20"></div>
              <div className="relative size-12 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                <Loader2 className="h-6 w-6 text-white animate-spin" />
              </div>
            </div>
            <p className="text-sm text-zinc-400 animate-pulse font-medium">Loading your conversation...</p>
          </div>
        ) : messages.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4 p-10" 
          >
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-900/20 mb-2">
              <Bot size={30} className="text-white" />
            </div>
            <h3 className="text-lg font-medium text-zinc-300">How can I help you today?</h3>
            <p className="text-sm text-center max-w-sm text-zinc-500">
              Ask me anything about market movements, financial performance, background information, 
              financial advice or for trading actions with Upstox.
            </p>
          </motion.div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ 
                  duration: 0.4,
                  type: "spring",
                  stiffness: 100,
                  damping: 15
                }}
                className={cn(
                  "flex gap-3 mb-4",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "agent" && (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md">
                    <Bot size={18} className="text-white" />
                  </div>
                )}
                
                <div
                  className={cn(
                    "max-w-[75%] px-5 py-4 text-sm shadow-lg backdrop-blur-sm",
                    message.role === "user" 
                      ? "bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl rounded-tr-md text-white shadow-lg" 
                      : "bg-gradient-to-r from-zinc-800/90 to-zinc-900/90 border border-white/5 rounded-2xl rounded-tl-md text-zinc-100"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words leading-relaxed font-medium">{message.content}</p>
                </div>
                
                {message.role === "user" && (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-400 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-md">
                    <User size={16} className="text-white" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        
        {/* Modern, pulsating thinking indicator */}
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 mb-4"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md">
              <Bot size={18} className="text-white" />
            </div>
            <div className="max-w-[75%] px-5 py-3 text-sm shadow-lg bg-gradient-to-r from-zinc-800/90 to-zinc-900/90 border border-white/5 rounded-2xl rounded-tl-md">
              <div className="flex items-center gap-3 min-w-[40px]">
                <motion.div 
                  animate={{ 
                    scale: [0.8, 1, 0.8],
                    opacity: [0.6, 1, 0.6] 
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                  }}
                  className="w-2 h-2 rounded-full bg-blue-400"
                />
                <motion.div 
                  animate={{ 
                    scale: [0.8, 1, 0.8],
                    opacity: [0.6, 1, 0.6] 
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    delay: 0.2
                  }}
                  className="w-2 h-2 rounded-full bg-blue-400"
                />
                <motion.div 
                  animate={{ 
                    scale: [0.8, 1, 0.8],
                    opacity: [0.6, 1, 0.6] 
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    delay: 0.4
                  }}
                  className="w-2 h-2 rounded-full bg-blue-400"
                />
              </div>
            </div>
          </motion.div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Modern confirmation dialog - appears when needed */}
      <AnimatePresence>
        {showConfirmDialog && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowConfirmDialog(false)}
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-xl p-5 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-full bg-amber-500/10">
                  <AlertCircle size={20} className="text-amber-400" />
                </div>
                <h3 className="text-lg font-medium text-white">Clear conversation?</h3>
                <button 
                  className="ml-auto p-1 rounded-full hover:bg-zinc-800" 
                  onClick={() => setShowConfirmDialog(false)}
                >
                  <X size={16} className="text-zinc-400" />
                </button>
              </div>
              <p className="text-sm text-zinc-400 mb-4">
                This will permanently delete your conversation history for this chat. This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfirmDialog(false)}
                  className="text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmClear}
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white rounded-xl"
                >
                  Clear
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Assistant Modal - Fixed position relative to viewport */}
      <AnimatePresence>
        {showVoiceModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-3xl"
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
            onClick={(e) => e.stopPropagation()} // Prevent click-through
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-md border border-white/30 rounded-3xl shadow-2xl overflow-hidden flex flex-col relative"
              onClick={(e) => e.stopPropagation()} // Prevent closing when clicking modal
            >
              {/* Modal top with close button */}
              <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-800/40">
                <div className="relative">
                  <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-indigo-400">
                    Voice Mode
                  </h2>
                </div>
                
                <button
                  onClick={closeVoiceModal}
                  className="p-1.5 rounded-full hover:bg-zinc-800/50 transition-colors"
                  aria-label="Close"
                >
                  <X className="h-5 w-5 text-zinc-400 hover:text-white" />
                </button>
              </div>
              
              {/* Main content - Simplified with just visualizer and controls */}
              <div className="flex-1 flex flex-col justify-between">
                {/* Visualizer - Larger now that we've removed messages */}
                <div className="p-6">
                  <div className="relative rounded-2xl overflow-hidden h-[220px] shadow-inne">
                    <canvas
                      ref={canvasRef}
                      width={800}
                      height={200}
                      className="w-full h-full"
                    />
                  </div>
                </div>

                {/* Controls - Centered in the modal */}
                <div className="px-6 pb-10">
                  <div className="flex justify-center">
                    {isSpeaking ? (
                      <button
                        onClick={stopSpeaking}
                        className="px-6 py-3.5 rounded-full font-medium flex items-center w-full max-w-[250px] justify-center relative overflow-hidden shadow-lg transition-all duration-200"
                      >
                        {/* Enhanced animated gradient for speaking state */}
                        <div 
                          className="absolute inset-0 z-0"
                          style={{
                            backgroundImage: 'linear-gradient(-45deg, #6366f1, #3b82f6, #8b5cf6, #4f46e5, #2563eb, #7c3aed)',
                            backgroundSize: '400% 400%',
                            backgroundPosition: '0% 50%',
                            animation: 'speaking-animation 3s ease infinite',
                          }}
                        />
                        <style jsx>{`
                          @keyframes speaking-animation {
                            0% { background-position: 0% 50%; box-shadow: 0 0 15px rgba(99, 102, 241, 0.6); }
                            25% { box-shadow: 0 0 25px rgba(139, 92, 246, 0.7); }
                            50% { background-position: 100% 50%; box-shadow: 0 0 20px rgba(79, 70, 229, 0.8); }
                            75% { box-shadow: 0 0 25px rgba(59, 130, 246, 0.7); }
                            100% { background-position: 0% 50%; box-shadow: 0 0 15px rgba(99, 102, 241, 0.6); }
                          }
                        `}</style>
                        <div className="relative z-10 flex items-center justify-center">
                          <div className="flex items-center mr-2 h-3">
                            <span className="w-0.5 h-1 bg-white mx-0.5 rounded-full animate-pulse"></span>
                            <span className="w-0.5 h-2 bg-white mx-0.5 rounded-full animate-pulse" style={{animationDelay: '150ms'}}></span>
                            <span className="w-0.5 h-3 bg-white mx-0.5 rounded-full animate-pulse" style={{animationDelay: '300ms'}}></span>
                            <span className="w-0.5 h-2 bg-white mx-0.5 rounded-full animate-pulse" style={{animationDelay: '450ms'}}></span>
                            <span className="w-0.5 h-1 bg-white mx-0.5 rounded-full animate-pulse" style={{animationDelay: '600ms'}}></span>
                          </div>
                          <span className="text-white">AI Speaking...</span>
                        </div>
                      </button>
                    ) : (
                      <button
                        onClick={toggleRecording}
                        disabled={isProcessing || isSpeaking || isLoading}
                        className={`px-6 py-3.5 rounded-full font-medium flex items-center justify-center w-full max-w-[250px] relative overflow-hidden transition-all duration-200 ${(isProcessing || isSpeaking || isLoading) ? 'opacity-50 cursor-not-allowed' : 'shadow-lg hover:shadow-xl'}`}
                      >
                        {/* Conditional animated backgrounds */}
                        {isProcessing || isLoading ? (
                          <div 
                            className="absolute inset-0 z-0"
                            style={{
                              backgroundImage: 'linear-gradient(-45deg, #6366f1, #4f46e5, #3b82f6, #2563eb)',
                              backgroundSize: '300% 300%',
                              backgroundPosition: '0% 50%',
                              animation: 'gradient-animation 3s ease infinite',
                            }}
                          />
                        ) : isRecording ? (
                          <div 
                            className="absolute inset-0 z-0"
                            style={{
                              backgroundImage: 'linear-gradient(-45deg, #ef4444, #dc2626, #b91c1c, #991b1b)',
                              backgroundSize: '300% 300%',
                              backgroundPosition: '0% 50%',
                              animation: 'pulse-animation 2s ease infinite',
                            }}
                          /> 
                          
                        ) : (
                          <div 
                            className="absolute inset-0 z-0"
                            style={{
                              backgroundImage: 'linear-gradient(-45deg, #3b82f6, #6366f1, #8b5cf6, #2563eb)',
                              backgroundSize: '300% 300%',
                              backgroundPosition: '0% 50%',
                              animation: 'gradient-animation 3s ease infinite',
                            }}
                          />
                        )}
                        
                        {/* Additional animation keyframes for pulse effect */}
                        <style jsx>{`
                          @keyframes gradient-animation {
                            0% { background-position: 0% 50% }
                            50% { background-position: 100% 50% }
                            100% { background-position: 0% 50% }
                          }
                          @keyframes pulse-animation {
                            0% { background-position: 0% 50%; opacity: 0.9 }
                            50% { background-position: 100% 50%; opacity: 1 }
                            100% { background-position: 0% 50%; opacity: 0.9 }
                          }
                        `}</style>
                        
                        <div className="relative z-10 flex items-center justify-center text-white">
                        {isProcessing ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Processing...
                          </>
                        ) : isRecording ? (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                            </svg>
                            Stop Listening
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                            </svg>
                            Start Listening
                          </>
                        )}
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer with hint - improved styling */}
              <div className="px-6 py-4 bg-gradient-to-b from-zinc-900/95 to-black border-t border-zinc-800/50 text-center">
                <p className="text-gray-400 text-sm">
                  {isRecording ? "Speak clearly into your microphone" :
                  isSpeaking ? "Listen to the AI response" :
                  "Click the button to start a voice conversation"}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clear Conversation button - Fixed position */}
      {messages.length > 0 && (
        <div className="sticky bottom-[72px] z-10 flex justify-center py-2 border-t border-zinc-800/30 bg-zinc-950/80 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearConversation}
            className="text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-full text-xs px-3 py-1"
          >
            <Trash2 size={12} className="mr-1.5" />
            Clear conversation
          </Button>
        </div>
      )}

      {/* Input Area with Voice Button - Fixed at bottom */}
      <div className="sticky bottom-0 z-20 px-6 py-4 bg-zinc-950/80 backdrop-blur-sm border-t border-zinc-800/30 rounded-b-[2.5rem]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative flex flex-col gap-2 sm:flex-row sm:items-center rounded-2xl border py-2 px-3 shadow-md border-zinc-800/50 bg-zinc-900/50 hover:border-zinc-700 transition-all duration-200"
        >
          {companyTicker && (
            <div className="bg-zinc-800 text-white rounded-xl px-2.5 py-1 border border-zinc-700/50 text-xs font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              {companyTicker}
            </div>
          )}
          
          <div className="flex-1 flex items-end relative" ref={inputRef}>
            <AutoResizeTextarea
              onKeyDown={handleKeyDown}
              onChange={(v) => setInputValue(v)}
              value={inputValue}
              disabled={isLoading}
              placeholder={
                isLoading 
                  ? "Processing your request..." 
                  : "Ask me anything about market movements, financial performance..."
              }
              className="placeholder:text-zinc-500 text-sm flex-1 bg-transparent focus:outline-none resize-none text-zinc-100 p-1.5 pr-24 rounded-xl"
            />
            
            <div className="absolute right-1 bottom-1 flex items-center justify-center gap-2">
              {/* Voice mode button with animated gradient */}
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  type="button"
                  onClick={openVoiceModal}
                  disabled={isLoading}
                  className="h-7 px-2 rounded-full relative overflow-hidden shadow-md transition-all duration-200 flex items-center justify-center gap-1.5"
                  aria-label="Voice mode"
                  style={{
                    position: 'relative',
                    isolation: 'isolate'
                  }}
                >
                  {/* Animated gradient background - implemented with CSS */}
                  <div 
                    className="absolute inset-0 z-0"
                    style={{
                      backgroundImage: 'linear-gradient(-45deg, #6366f1, #8b5cf6, #3b82f6, #4f46e5)',
                      backgroundSize: '300% 300%',
                      backgroundPosition: '0% 50%',
                      animation: 'gradient-animation 3s ease infinite',
                    }}
                  />
                  
                  {/* Inline animation keyframes */}
                  <style jsx>{`
                    @keyframes gradient-animation {
                      0% { background-position: 0% 50% }
                      50% { background-position: 100% 50% }
                      100% { background-position: 0% 50% }
                    `}
                  </style>
                  
                  {/* Content */}
                  <div className="relative z-10 flex items-center justify-center gap-1.5">
                    <Mic size={14} className="text-white" /> 
                    <span className="text-xs font-medium text-white">Voice Mode</span>
                  </div>
                </Button>
              </motion.div>
              
              {/* Send button */}
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  type="submit"
                  disabled={isLoading || !inputValue.trim()}
                  className="size-7 rounded-full bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white shadow-md transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowUpIcon size={14} />
                  )}
                </Button>
              </motion.div>
            </div>
          </div>
        </form>
        <div className="text-[12px] text-center text-zinc-500 mt-1">
          {isLoading 
            ? "Thinking..." 
            : "Be clear and concise with your questions to obtain the best results."}
        </div>
      </div>
    </div>
  );
}