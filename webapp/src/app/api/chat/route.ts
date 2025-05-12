import { type CoreMessage, streamText } from "ai"
import { openai } from "@ai-sdk/openai"

export async function POST(req: Request) {
  const { messages }: { messages: CoreMessage[] } = await req.json()

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL || "gpt-4o-mini"),
    system: `You are a knowledgeable stock market assistant specializing in Indian markets, particularly the NIFTY 50 index.
    
    You can provide:
    - Information about companies and their financial performance
    - Market trends and analysis
    - Investment advice and portfolio strategies
    - Explanations of financial terms and concepts
    - Latest financial news and its impact
    
    Always be professional, concise, and helpful. When discussing stock prices or market movements, 
    acknowledge that these are simulated values for demonstration purposes.`,
    messages,
  })

  return result.toDataStreamResponse()
}
