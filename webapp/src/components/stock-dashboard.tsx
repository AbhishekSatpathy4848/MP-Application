"use client"

import { useEffect, useState, useCallback } from "react"
import { Stock, StockList } from "@/components/stock-list"
import { ChatInterface } from "@/components/chat-interface"
import { fetchStocksData } from "@/lib/stock-data"
import Image from "next/image"
import { Button } from "./ui/button"
import { Dialog, DialogTrigger } from "./ui/dialog"
import { DialogBox } from "./agent-dialog"
import { useCompany } from "@/hooks/use-company"
import Link from "next/link"

export function StockDashboard() {
  const [stockData, setStockData] = useState<Stock[]>([])
  const [loading, setLoading] = useState(true)
  const { company, setCompany } = useCompany()
  const [initialLoad, setInitialLoad] = useState(true)

  // Use useCallback to prevent recreation of fetch function on each render
  const fetchData = useCallback(async (isInitialLoad = false) => {
    try {
      // Only show loading indicator on initial load
      if (isInitialLoad && stockData.length === 0) {
        setLoading(true);
      }
      
      const newData = await fetchStocksData();
      
      // Update only the changing fields while keeping component identity stable
      setStockData(prevData => {
        // If it's initial load or empty data, replace completely
        if (prevData.length === 0) {
          return newData;
        }
        
        // Only update the specific changing fields (price, change, changePercent)
        // while preserving reference equality for unchanged stocks
        return prevData.map(oldStock => {
          const updatedStock = newData.find(s => s.symbol === oldStock.symbol);
          
          if (!updatedStock) {
            return oldStock; // Keep the old stock if not found in new data
          }
          
          // Only create a new object if values have actually changed
          if (
            oldStock.price !== updatedStock.price ||
            oldStock.change !== updatedStock.change ||
            oldStock.changePercent !== updatedStock.changePercent
          ) {
            // Create a new object but preserve all non-changing fields
            return {
              ...oldStock,
              price: updatedStock.price,
              change: updatedStock.change,
              changePercent: updatedStock.changePercent
            };
          }
          
          // Return the exact same object reference if nothing changed
          return oldStock;
        });
      });
      
      if (isInitialLoad) {
        setInitialLoad(false);
        setLoading(false);
      }
    } catch (error) {
      console.error("Error fetching stock data:", error);
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, []);  // Remove stockData dependency to prevent excessive re-renders

  useEffect(() => {
    // Initial fetch with loading indicator
    fetchData(true);
    
    // Use 10000 ms (10 seconds) as intended
    const intervalId = setInterval(() => fetchData(false), 2000);
    
    return () => clearInterval(intervalId);
  }, [fetchData]);

  return (
    <div className="flex w-full h-full m-2 p-2 flex-col bg-zinc-950 text-white rounded-3xl shadow-xl">
      <Dialog>
        <div className="sticky top-0 z-10 flex items-center justify-between bg-zinc-900 p-3 rounded-2xl border-b border-zinc-800 shadow-md mb-2">
          <div className="flex items-center">
            <Image 
              src="/fingreat.png" 
              alt="FinGReaT Logo" 
              width={40} 
              height={40} 
              className="mx-2 rounded-full shadow-lg" 
            />
            <h2 className="text-lg font-bold tracking-wider drop-shadow-md bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 text-transparent bg-clip-text">
              FinGReaT
            </h2>
          </div>
          
          {/* Trade with section */}
          <div className="flex items-center space-x-5 ml-auto mr-3">
            <h2 className="text-sm font-semibold text-zinc-300">Trade with</h2>
            <div className="flex items-center group transition-all duration-300">
              <Link href="https://upstox.com/" target="_blank" rel="noopener noreferrer">
                <Image
                  src="/upstox_logo.png"
                  alt="Upstox"
                  width={42}
                  height={42}
                  className="transition-transform relative duration-300 transform group-hover:translate-x-0 -ml-2 z-40 hover:scale-110 rounded-full p-1 bg-zinc-800 hover:bg-zinc-700"
                />
              </Link>
              <Link href="https://kite.zerodha.com/" target="_blank" rel="noopener noreferrer">
                <Image
                  src="/kite_logo.png"
                  alt="Kite"
                  width={42}
                  height={42}
                  className="transition-transform relative right-4 duration-300 transform group-hover:translate-x-5 -ml-2 z-30 hover:scale-110 rounded-full p-1 bg-zinc-800 hover:bg-zinc-700"
                />
              </Link>
              <Link href="https://groww.in/" target="_blank" rel="noopener noreferrer">
                <Image
                  src="/groww_logo.png"
                  alt="Groww"
                  width={42}
                  height={42}
                  className="transition-transform relative right-8 duration-300 transform group-hover:translate-x-10 -ml-2 z-20 hover:scale-110 rounded-full p-1 bg-zinc-800 hover:bg-zinc-700"
                />
              </Link>
              <Link href="https://zerodha.com/" target="_blank" rel="noopener noreferrer">
                <Image
                  src="/zerodha_logo.png"
                  alt="Zerodha"
                  width={42}
                  height={42}
                  className="transition-transform relative right-12 duration-300 transform group-hover:translate-x-15 -ml-2 z-10 hover:scale-110 rounded-full p-1 bg-zinc-800 hover:bg-zinc-700"
                />
              </Link>
            </div>
          </div>
          {/* End of Trade with section */}
          <DialogTrigger asChild>
            <Button
              className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 active:from-blue-600 active:to-indigo-700 text-white rounded-full px-4 py-2 font-medium transition-all duration-300 hover:scale-105 active:scale-105 border border-blue-400/20 hover:shadow-lg active:shadow-inner"
              onClick={() => {}}
            >
              <span className="flex items-center gap-2">
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  className="text-white"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                Talk to AI Agent
              </span>
            </Button>
          </DialogTrigger>
        </div>

        <div className="flex flex-row gap-3 p-2 h-full overflow-y-auto">
          <div className="relative w-1/4 h-full overflow-y-auto border-r border-zinc-800 rounded-2xl bg-zinc-900/50 shadow-inner">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 bg-opacity-60 rounded-2xl backdrop-blur-sm">
                <div className="loader"></div>
              </div>
            ) : (
              <StockList
                stocks={stockData}
                onSelectStock={(symbol) => setCompany(symbol)}
                selectedStock={company}
              />
            )}
          </div>

          <div className="w-3/4 bg-zinc-900 p-5 rounded-2xl shadow-lg">
            <ChatInterface selectedStock={company} />
          </div>
        </div>
        <DialogBox />
      </Dialog>
    </div>
  )
}