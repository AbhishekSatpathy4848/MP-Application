import { memo } from "react"
import { Stock } from "./stock-list"
import { cn } from "@/lib/utils"
import { TrendingDown, TrendingUp } from "lucide-react"

interface StockCardProps {
  stock: Stock
  onClick: () => void
  isSelected: boolean
  disabled?: boolean // Add disabled prop
}

// Use memo to prevent unnecessary re-renders
export const StockCard = memo(function StockCard({ stock, onClick, isSelected, disabled = false }: StockCardProps) {
  const isPositive = stock.change >= 0
  
  return (
    <div
      className={cn(
        "flex cursor-pointer flex-col rounded-xl p-2 transition-all duration-200",
        isSelected 
          ? "bg-blue-600/10 border border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.1)]" 
          : "bg-zinc-900 border border-zinc-800 hover:bg-zinc-800/80",
        disabled && "opacity-60 cursor-not-allowed hover:bg-zinc-900" // Add disabled styling
      )}
      onClick={disabled ? undefined : onClick} // Prevent click when disabled
    >
      <div className="flex justify-between items-center mb-1">
        <span className="font-semibold text-[10px] text-white">{stock.symbol}</span>
        <span 
          className={cn(
            "font-medium text-[10px]",
            isPositive ? "text-green-500" : "text-red-500"
          )}
        >
          ₹{stock.price.toFixed(2)}
        </span>
      </div>
      
      <div className="flex justify-between items-center">
        <span className="text-[8px] text-zinc-400 truncate max-w-[60%] mr-1">{stock.name}</span>
        <div 
          className={cn(
            "text-[8px] px-1 py-0.5 rounded-full font-medium flex items-center",
            isPositive 
              ? "bg-green-500/10 text-green-500 border border-green-500/20" 
              : "bg-red-500/10 text-red-500 border border-red-500/20"
          )}
        >
          {isPositive 
            ? <TrendingUp className="mr-0.5 h-2 w-2" /> 
            : <TrendingDown className="mr-0.5 h-2 w-2" />
          }
          <span>
            {isPositive ? "+" : ""}{stock.change.toFixed(2)} ({isPositive ? "+" : ""}{stock.changePercent.toFixed(2)}%)
          </span>
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison function to prevent unnecessary re-renders
  // Only re-render if one of these conditions is true
  return (
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.disabled === nextProps.disabled && // Add disabled to comparison
    prevProps.stock.symbol === nextProps.stock.symbol &&
    prevProps.stock.name === nextProps.stock.name &&
    prevProps.stock.price === nextProps.stock.price &&
    prevProps.stock.change === nextProps.stock.change &&
    prevProps.stock.changePercent === nextProps.stock.changePercent
  )
})