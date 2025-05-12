"use client"

import React, { useEffect, useRef, useState } from "react"
import { ArrowUpIcon, ChevronUpIcon, ChevronDownIcon, MinusIcon, Loader2, RefreshCcw, MessageCircle } from "lucide-react"
import Image from "next/image"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { getStockData } from "@/lib/stock-data"

import { Button } from "@/components/ui/button"
import { AutoResizeTextarea } from "@/components/autoresize-textarea"
import { StockChart } from "@/components/stock-chart"

// Create client-side only Lottie component
import dynamic from 'next/dynamic'

const LottieAnimation = dynamic(() => import('./lottie-animation'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-36 w-36">
      <div className="animate-pulse bg-blue-500/10 h-24 w-24 rounded-full flex items-center justify-center">
        {/* <span className="text-3xl"></span> */}
      </div>
    </div>
  )
})

interface ChatInterfaceProps {
  selectedStock: string | null
  onProcessingStateChange?: (isProcessing: boolean) => void
}

type UIMessage =
  | {
    type: "user"
    role: "user"
    content: string
  }
  | {
    type: "stream"
    role: "assistant"
    content: {
      stage: number
      message: string
      total_stages: number
    }
  }
  | {
    type: "result"
    role: "assistant"
    content: {
      result: "UP" | "DOWN" | "NEUTRAL"
      explanation: string
    }
  }

// States of the interface
type InterfaceState = "EMPTY" | "PROCESSING" | "RESULT"

// TypeWriter component for animating text display
const TypeWriter = ({ text }: { text: string }) => {
  const [displayedText, setDisplayedText] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText((prev) => prev + text[currentIndex])
        setCurrentIndex((c) => c + 1)
      }, 15) // Adjust speed here

      return () => clearTimeout(timeout)
    }
  }, [currentIndex, text])

  return (
    <>
      {displayedText}
      {currentIndex < text.length && (
        <motion.span
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.7, repeat: Infinity }}
          className="inline-block ml-0.5 w-px h-4 bg-blue-400 align-middle"
        />
      )}
    </>
  )
}

// Loading animation component with fixed spacing
const LoadingAnimation = ({ currentStage }: { currentStage: { stage: number; total: number; message: string } | null }) => {
  return (
    <div className="flex items-center justify-center pb-6">
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="relative w-28 h-28">
          <LottieAnimation color="#60a5fa" />
        </div>
        <motion.div
          className="text-blue-400 font-semibold text-base text-center"
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          {currentStage?.message || "Analyzing..."}
        </motion.div>
        <motion.div 
          className="text-2xs text-zinc-400 mt-0.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Stage {currentStage?.stage || 1} of {currentStage?.total || 9}
        </motion.div>
      </motion.div>
    </div>
  );
};

export function ChatInterface({ selectedStock, onProcessingStateChange }: ChatInterfaceProps) {
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [stockData, setStockData] = useState<{
    symbol: string
    name: string
    price: number
    change: number
    changePercent: number
  } | null>(null)

  // Track current UI state
  const [interfaceState, setInterfaceState] = useState<InterfaceState>("EMPTY")
  const [currentPrompt, setCurrentPrompt] = useState<string>("")
  const [currentResult, setCurrentResult] = useState<{
    result: "UP" | "DOWN" | "NEUTRAL"
    explanation: string
  } | null>(null)

  // Track current processing stages
  const [currentProcessingStages, setCurrentProcessingStages] = useState<{
    stage: number
    total: number
    message: string
  } | null>(null)

  // Add state for stage transitions with minimum display time
  const [displayedStage, setDisplayedStage] = useState<{
    stage: number;
    total: number;
    message: string;
  } | null>(null);

  // Add ref to track stage change time
  const stageChangeTimeRef = useRef<number>(Date.now());
  const stageTransitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const contentRef = useRef<HTMLDivElement>(null)
  const previousStock = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null); // Reference for scrolling to results
  const [isProcessingActive, setIsProcessingActive] = useState(false);

  // Reset state when stock changes (only if not processing)
  useEffect(() => {
    // Block stock changes during processing
    if (isProcessingActive) {
      return; // Don't allow stock change during processing
    }
    
    // If stock actually changed (not just initial load)
    if (previousStock.current && previousStock.current !== selectedStock) {
      // Reset all state to clean state
      resetStateForNewStock();
    }
    
    previousStock.current = selectedStock;
    
    if (!selectedStock) return;

    // Now attempt to load any saved state for this stock
    const storedState = localStorage.getItem(`interface_state_${selectedStock}`);
    const storedPrompt = localStorage.getItem(`current_prompt_${selectedStock}`);
    const storedResult = localStorage.getItem(`current_result_${selectedStock}`);

    if (storedState && ["EMPTY", "PROCESSING", "RESULT"].includes(storedState)) {
      // Processing state should always be reset to EMPTY on reload to avoid stuck UIs
      setInterfaceState(storedState === "PROCESSING" ? "EMPTY" : storedState as InterfaceState);
    } else {
      setInterfaceState("EMPTY");
    }

    if (storedPrompt) setCurrentPrompt(storedPrompt);

    if (storedResult) {
      try {
        setCurrentResult(JSON.parse(storedResult));
      } catch (e) {
        console.error("Error parsing stored result:", e);
        setCurrentResult(null);
      }
    }

    const stored = localStorage.getItem(`chat_${selectedStock}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        } else {
          setMessages([]); // fallback for invalid data
        }
      } catch (e) {
        console.error("Error parsing localStorage data:", e);
        setMessages([]);
      }
    } else {
      setMessages([]); // No stored messages
    }
  }, [selectedStock, isProcessingActive]);

  // Reset all state when changing stocks
  const resetStateForNewStock = () => {
    setInterfaceState("EMPTY");
    setCurrentPrompt("");
    setCurrentResult(null);
    setCurrentProcessingStages(null);
    setMessages([]);
    setInput("");
    setIsLoading(false);
  };

  // Save state to localStorage when it changes
  useEffect(() => {
    if (!selectedStock) return

    localStorage.setItem(`interface_state_${selectedStock}`, interfaceState)
    if (currentPrompt) {
      localStorage.setItem(`current_prompt_${selectedStock}`, currentPrompt)
    }
    if (currentResult) {
      localStorage.setItem(`current_result_${selectedStock}`, JSON.stringify(currentResult))
    }
    localStorage.setItem(`chat_${selectedStock}`, JSON.stringify(messages))
  }, [interfaceState, currentPrompt, currentResult, messages, selectedStock])

  // Scroll to the top of the content when interfaceState changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }, [interfaceState])

  // Scroll to result when it's received
  useEffect(() => {
    if (interfaceState === "RESULT" && resultRef.current) {
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 500); // Small delay to allow for animation
    }
  }, [interfaceState]);

  // Update isProcessingActive state when interfaceState changes
  useEffect(() => {
    if (interfaceState === "PROCESSING") {
      setIsProcessingActive(true);
      // Notify parent component about processing state
      onProcessingStateChange?.(true);
    } else {
      setIsProcessingActive(false);
      // Notify parent component about processing state
      onProcessingStateChange?.(false);
    }
  }, [interfaceState, onProcessingStateChange]);

  // Fetch stock info
  useEffect(() => {
    const fetchStockData = async () => {
      if (selectedStock) {
        try {
          const data = await getStockData(selectedStock)
          setStockData(data)
        } catch (error) {
          console.error("Error fetching stock data:", error)
        }
      }
    }

    fetchStockData()
  }, [selectedStock])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!input.trim() || !selectedStock || isProcessingActive) return

    const userMessage = input.trim()
    setCurrentPrompt(userMessage)
    setInterfaceState("PROCESSING")
    setIsProcessingActive(true) // Set processing active

    // Add the user message to the chat history
    setMessages((prevMessages) => [
      ...prevMessages,
      { type: "user", role: "user", content: userMessage }
    ])

    setIsLoading(true)
    setInput("")
    setCurrentResult(null)

    const date_of_publish = new Date().toISOString().replace("T", " ").split(".")[0] + ".000"

    try {
      await handleSend({
        news_article: userMessage,
        company_ticker: selectedStock,
        date_of_publish
      })
    } catch (error) {
      console.error("Error sending message:", error)

      // Add error message and return to empty state
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          type: "stream",
          role: "assistant",
          content: {
            stage: 1,
            message: "Sorry, there was an error processing your request. Please try again.",
            total_stages: 1
          }
        }
      ])
      setInterfaceState("EMPTY")
    } finally {
      setIsLoading(false)
    }
  }

  // Handle key down event (for Enter key submission)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const form = e.currentTarget.closest("form")
      if (form) form.requestSubmit()
    }
  }

  // Function to add parsed messages to the chat
  const addChatMessage = ({ type, content }: { type: "stream" | "result"; content: any }) => {
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        type,
        role: "assistant",
        content
      }
    ])
  }

  async function handleSend({
    news_article,
    company_ticker,
    date_of_publish
  }: {
    news_article: string
    company_ticker: string
    date_of_publish: string
  }) {
    if (!process.env.NEXT_PUBLIC_API_URL) {
      console.error("API URL is not defined")
      return
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/process_news`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      keepalive: true,
      body: JSON.stringify({
        news_article,
        company_ticker,
        date_of_publish
      })
    })

    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`)
    }

    if (!response.body) {
      throw new Error("Response body is null")
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder("utf-8")
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split("\n")

      // Fix the infinite loop issue with proper index bounds checking
      for (let i = 0; i < parts.length - 1; i++) {
        try {
          const parsed = JSON.parse(parts[i])
          handleParsedMessage(parsed)
        } catch (error) {
          console.error("Failed to parse chunk:", parts[i], error)
        }
      }

      buffer = parts[parts.length - 1]
    }
  }

// Simplified function that updates stages immediately without any waiting
function handleParsedMessage(msg: any) {
  if (msg.result && (msg.result === "UP" || msg.result === "DOWN" || msg.result === "NEUTRAL")) {
    // Final result received
    setCurrentProcessingStages(null);
    setDisplayedStage(null);
    
    setCurrentResult({
      result: msg.result,
      explanation: msg.explanation
    });
    
    setInterfaceState("RESULT");
    addChatMessage({ type: "result", content: msg });
  } else if (msg.message) {
    // Process progress update
    const stageInfo = {
      stage: msg.stage || 1,
      total: msg.total_stages || 9,
      message: msg.message
    };
    
    // Update both the internal stage tracker and displayed stage immediately
    setCurrentProcessingStages(stageInfo);
    setDisplayedStage(stageInfo);
    
    // Only add the first stage as a chat message
    if (stageInfo.stage === 1) {
      addChatMessage({
        type: "stream",
        content: {
          message: msg.message,
          stage: stageInfo.stage,
          total_stages: stageInfo.total
        }
      });
    }
  } else {
    console.warn("Unhandled message format:", msg);
  }
}

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (stageTransitionTimeoutRef.current) {
        clearTimeout(stageTransitionTimeoutRef.current);
      }
    };
  }, []);

  const resetInterface = () => {
    setInterfaceState("EMPTY")
    setCurrentPrompt("")
    setCurrentResult(null)
    setCurrentProcessingStages(null)
  }

  // Function to check if input should be disabled
  const isInputDisabled = () => {
    return isLoading || !selectedStock || interfaceState === "PROCESSING" || interfaceState === "RESULT";
  }

  // Content for the three states
  const renderContent = () => {
    switch (interfaceState) {
      case "EMPTY":
        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className={`flex ${selectedStock ? 'flex-row items-center justify-center' : 'flex-col items-center justify-center'} h-full space-y-0 ${selectedStock ? 'space-x-8' : 'space-y-8'} text-center px-6`}
          >
            <motion.div
              whileHover={{ rotate: 5, scale: 1.05 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="bg-gradient-to-br from-zinc-700/50 to-zinc-900 rounded-full p-6 shadow-xl border border-zinc-700/50"
            >
              <Image
                src="/fingreat.png"
                alt="FinGReaT Logo"
                width={selectedStock ? 80 : 100}
                height={selectedStock ? 80 : 100}
                className="rounded-full"
              />
            </motion.div>
            <div className={`space-y-4 max-w-md ${selectedStock ? 'text-left' : ''}`}>
              <motion.h1
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 text-transparent bg-clip-text"
              >
                Welcome to FinGReaT
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-zinc-300 text-sm leading-relaxed"
              >
                Your AI assistant for analyzing financial news and predicting market impacts.
                {selectedStock ? (
                  <span className="block mt-2 text-blue-400 text-xs">
                    Enter news about <strong>{selectedStock}</strong> to analyze.
                  </span>
                ) : (
                  <span className="block mt-2 text-amber-400 text-xs">
                    Please select a stock from the sidebar first.
                  </span>
                )}
              </motion.p>
            </div>
          </motion.div>
        )

      case "PROCESSING":
        return (
          <div className="flex flex-col h-full p-6 space-y-8">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-r from-zinc-900 to-zinc-900/80 rounded-xl border border-zinc-800 shadow-lg p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="bg-blue-500/10 p-1.5 rounded-full">
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="14" 
                    height="14" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    className="text-blue-400"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <div className="text-xs text-zinc-400 uppercase font-medium tracking-wide">Input News</div>
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="bg-zinc-800/30 p-3 rounded-lg border border-zinc-800/80 text-zinc-300 font-normal text-sm"
              >
                "{currentPrompt}"
              </motion.div>
            </motion.div>
            
            {/* Use displayedStage for showing the loading animation */}
            <LoadingAnimation currentStage={displayedStage} />
          </div>
        )

      case "RESULT":
        if (!currentResult) return null

        const resultStyles = {
          UP: {
            gradient: "from-green-900/20 to-green-700/10",
            border: "border-green-500/30",
            icon: <ChevronUpIcon className="text-green-400 size-8" />,
            title: "Bullish Impact",
            titleColor: "text-green-400"
          },
          DOWN: {
            gradient: "from-red-900/20 to-red-700/10",
            border: "border-red-500/30",
            icon: <ChevronDownIcon className="text-red-400 size-8" />,
            title: "Bearish Impact",
            titleColor: "text-red-400"
          },
          NEUTRAL: {
            gradient: "from-blue-900/20 to-blue-700/10",
            border: "border-blue-500/30",
            icon: <MinusIcon className="text-blue-400 size-8" />,
            title: "Neutral Impact",
            titleColor: "text-blue-400"
          }
        }

        const style = resultStyles[currentResult.result]

        return (
          <div className="flex flex-col h-full p-6 space-y-6 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-r from-zinc-900 to-zinc-900/80 rounded-xl border border-zinc-800 shadow-lg p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="bg-blue-500/10 p-1.5 rounded-full">
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="14" 
                    height="14" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    className="text-blue-400"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <div className="text-xs text-zinc-400 uppercase font-medium tracking-wide">Input News</div>
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="bg-zinc-800/30 p-3 rounded-lg border border-zinc-800/80 text-zinc-300 font-normal text-sm"
              >
                "{currentPrompt}"
              </motion.div>
            </motion.div>

            <motion.div
              ref={resultRef} // Add ref for scrolling
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, type: "spring" }}
              className={`bg-gradient-to-br ${style.gradient} rounded-xl border ${style.border} p-6 shadow-xl`}
            >
              <div className="flex items-center gap-4 mb-5">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1, rotate: [0, 15, 0] }}
                  transition={{ delay: 0.5, type: "tween", duration: 0.6 }}
                  className="bg-zinc-800 rounded-full p-4 shadow-md"
                >
                  {style.icon}
                </motion.div>
                <div>
                  <h3 className={`text-xl font-bold ${style.titleColor}`}>{style.title}</h3>
                  <p className="text-zinc-400 text-xs">Analysis of {selectedStock} news impact</p>
                </div>
              </div>

              <div className="text-zinc-100 font-normal leading-relaxed text-base">
                <TypeWriter text={currentResult.explanation} />
              </div>

              <div className="mt-8 flex gap-3 justify-end">
                <Button
                  onClick={resetInterface}
                  variant="outline"
                  className="border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full"
                >
                  <RefreshCcw className="size-4" />
                  New Analysis
                </Button>
                {/* <Button
                  onClick={() => {
                    // Continue conversation logic
                    setInterfaceState("EMPTY")
                    setInput(`Tell me more about the ${currentResult.result.toLowerCase()} impact on ${selectedStock}.`)
                  }}
                  className="bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white rounded-full"
                >
                 <svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth="2"
  strokeLinecap="round"
  strokeLinejoin="round"
  className="text-white"
>
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1-2-2h14a2 2 0 0 1-2 2z" />
</svg>

                  Continue with AI Agent
                </Button> */}
              </div>
            </motion.div>
          </div>
        )
    }
  }

  // Modify the input form to be disabled in RESULT state too
  return (
    <div className="flex h-full flex-col rounded-2xl overflow-hidden bg-zinc-900/90 border border-zinc-800 shadow-xl transition-all duration-300 ease-in-out">
      {/* Header */}
      {selectedStock && stockData ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="border-b p-4 border-zinc-700 bg-zinc-800/70 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <motion.h2
              initial={{ x: -20 }}
              animate={{ x: 0 }}
              transition={{ type: "spring", stiffness: 100 }}
              className="text-xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent"
            >
              {stockData.name} ({selectedStock})
            </motion.h2>
            <motion.div
              initial={{ x: 20 }}
              animate={{ x: 0 }}
              transition={{ type: "spring", stiffness: 100 }}
              className={cn(
                "flex items-center gap-2 text-sm font-medium rounded-full px-3 py-1 shadow-sm",
                stockData.change >= 0
                  ? "text-green-400 bg-green-950/50 border border-green-800/30"
                  : "text-red-400 bg-red-950/50 border border-red-800/30"
              )}
            >
              ₹{stockData.price.toLocaleString()}
              <span>
                {stockData.change >= 0 ? "+" : ""}
                {stockData.change.toFixed(2)} ({stockData.changePercent.toFixed(2)}%)
              </span>
            </motion.div>
          </div>
          <StockChart symbol={selectedStock} />
        </motion.div>
      ) : (
        <div className="border-b p-4 border-zinc-700 bg-zinc-800/70 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Select a stock
            </h2>
          </div>
        </div>
      )}

      {/* Content Area - Different for each state */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-900"
      >
        {renderContent()}
      </div>

      {/* Input Form - Not visible in RESULT state */}
      {interfaceState !== "RESULT" && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, type: "spring" }}
          className="border-t border-zinc-800/50 bg-zinc-900/70 backdrop-blur-md p-3"
        >
          <form
            onSubmit={handleSubmit}
            className="relative flex flex-col gap-2 sm:flex-row sm:items-center rounded-xl border py-2 px-3 shadow-md border-zinc-800/50 bg-zinc-900/50 hover:border-zinc-700 transition-all duration-200"
          >
            <div className="bg-zinc-800 text-white rounded-xl px-2.5 py-1 border border-zinc-700/50 text-xs font-medium flex items-center gap-1.5">
              {selectedStock ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  {selectedStock}
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  Select a stock
                </>
              )}
            </div>
            <div className="flex-1 flex items-end relative">
              <AutoResizeTextarea
                onKeyDown={handleKeyDown}
                onChange={(v) => setInput(v)}
                value={input}
                disabled={isInputDisabled()}
                placeholder={
                  isProcessingActive 
                    ? "Processing your request..." 
                    : selectedStock 
                      ? "Enter news about this stock..." 
                      : "Select a stock first..."
                }
                className="placeholder:text-zinc-500 text-sm flex-1 bg-transparent focus:outline-none resize-none text-zinc-100 p-1.5 pr-12 rounded-xl"
              />
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="absolute right-1 bottom-1 flex items-center justify-center"
              >
                <Button
                  type="submit"
                  disabled={isLoading || !input.trim() || !selectedStock || isProcessingActive}
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
          </form>
          <div className="text-[10px] text-center text-zinc-500 mt-1">
            {isProcessingActive 
              ? "Please wait while we analyze the news..." 
              : "Use clear and specific financial news for best analysis results"}
          </div>
        </motion.div>
      )}
    </div>
  )
}