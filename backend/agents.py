# Type of Agents
# 1. Stock Price Agent - get_stock_price_range_tool - Read past stock data for a company and answer questions accordingly
# 2. Financial Report Agent - get_company_financials_tool - Read past financial data for a company and answer questions accordingly
# 3. Company Background Agent - get_company_background_information_tool - Read past company background information and answer questions accordingly
# 4. Upstox Trading Agent - view_upstox_account_balance_tool, place_upstox_order_tool, get_live_market_price_tool - Make Trades on the Upstox platform on behalf of the user

from llm_calls import query_gemini, query_open_ai
import sys
from datetime import datetime, timedelta
import json
import os

from tools import (
    get_stock_price_range_tool,
    get_company_financials_tool,
    get_company_background_information_tool,
    view_upstox_account_balance_tool,
    place_upstox_order_tool,
    get_live_market_price_tool
)

from templates import INSTRUMENT_KEYS
from fingreat import to_json

class ChatSession:
    def __init__(self, user_id, company_name):
        self.user_id = user_id
        self.company_name = company_name
        self.messages = []
        self.created_at = datetime.now()
        self.last_updated = datetime.now()

    def add_message(self, role, content):
        self.messages.append({"role": role, "content": content})
        self.last_updated = datetime.now()

    def get_conversation_text(self):
        return "\n".join([f"{msg['role']}: {msg['content']}" for msg in self.messages])

# Updated conversation storage structure
user_conversations = {
    "stock_agent": {},      # {user_id: {company: ChatSession}}
    "financial_agent": {},   # {user_id: {company: ChatSession}}
    "background_agent": {},  # {user_id: {company: ChatSession}}
    "trading_agent": {},     # {user_id: {company: ChatSession}}
    "master_agent": {}       # {user_id: {company: ChatSession}}
}

TOOL_DESCRIPTIONS = {
    "get_stock_price_range_tool": {
        "description": "Fetches historical stock price data (OHLCV) for a given Nifty 50 company between a start and end date.",
        "parameters": {
            "company_name": "Name of the company.",
            "start_date": "Start date in format 'YYYY-MM-DD'.",
            "end_date": "End date in format 'YYYY-MM-DD'."
        },
        "returns": "DataFrame containing columns: Date, Open, High, Low, Close, and Volume."
    },
    "get_company_financials_tool": {
        "description": "Retrieves a structured financial report for a given company.",
        "parameters": {
            "company": "Name of the company."
        },
        "returns": (
            "A multi-section textual financial report as a string. "
            "Includes:\n"
            "- Quarterly Performance (Last 4 Quarters)\n"
            "- Yearly Performance (Last 2 Years)\n"
            "- Cumulative Performance Over Time\n"
            "- Trailing Twelve Months (TTM) Performance"
        )
    },
    "get_company_background_information_tool": {
        "description": "Generates a company summary using a knowledge graph of financial entities and relationships.",
        "parameters": {
            "company": "Name of the company."
        },
        "returns": "A summary of all the background information of the company."
    },
    "view_upstox_account_balance_tool": {
        "description": "Returns the available funds for buying stocks/equity from the Upstox trading account.",
        "parameters": {},
        "returns": "A float or integer representing the available fund balance."
    },
    "place_upstox_order_tool": {
        "description": "Places an equity order (BUY/SELL) on Upstox for a given instrument.",
        "parameters": {
            "instrument_token": "Unique instrument key (e.g., 'NSE_EQ|INE669E01016').",
            "order_type": "Either 'LIMIT' or 'MARKET'.",
            "quantity": "Number of shares to trade.",
            "price": "Price to buy/sell share at (0 for MARKET orders).",
            "transaction_type": "Either 'BUY' or 'SELL'."
        },
        "returns": "Order ID string if successful, otherwise None."
    },
    "get_live_market_price_tool": {
        "description": "Fetches the live Last Traded Price (LTP) for a given instrument on Upstox.",
        "parameters": {
            "instrument_token": "Unique instrument key (e.g., 'NSE_EQ|INE669E01016')."
        },
        "returns": "A float representing the live market price of the instrument."
    }
}

# ----------------------------------------------
# Constants and Prompt Templates
# ----------------------------------------------

STOCK_ANALYSIS_SYSTEM_PROMPT = """You are a financial analyst AI. You are provided with the OHLC (Open, High, Low, Close) stock data for {company} from {start_date} to {end_date} and are supposed to answer questions based on what the user asks.
Use trends, volatility, and movement in prices and carefully answer the questions.

Here is the OHLC data:

{ohlc_data}

Be very consice and to the point. Do not add any extra information. Answer in a paragraph. All data is in INR.
"""

FINANCIALS_SYSTEM_PROMPT = """You are a financial expert AI. Based on the financial report for {company}, answer user queries thoughtfully. Provide numerical insight and commentary from the report where needed.

Here is the financial report:

{financial_report}

Be very consice and to the point. Do not add any extra information. Answer in a paragraph and don't say you are an AI Agent who doesn't know the answer, try to estimate if not guesstimate the result. All data is in INR.
"""

BACKGROUND_SYSTEM_PROMPT = """You are a knowledge-based assistant specializing in company backgrounds. Use the summary data for {company} to answer user queries regarding the company's history, management, sectors, etc.

Here is the company background:

{company_background}

Be very consice and to the point. Do not add any extra information. Answer in a paragraph.
"""

TRADING_SYSTEM_PROMPT = f"""
You are a highly reliable Upstox trading assistant.

You have access to the following tools:
- view_upstox_account_balance_tool: {TOOL_DESCRIPTIONS["view_upstox_account_balance_tool"]}
- place_upstox_order_tool: {TOOL_DESCRIPTIONS["place_upstox_order_tool"]}
- get_live_market_price_tool: {TOOL_DESCRIPTIONS["get_live_market_price_tool"]}

You must always strictly respond ONLY in the following JSON format:
{{
  "function": "<function_name>",     // If you need to call a tool, specify the function name.
  "arguments": {{
    "key1": "value1",
    "key2": "value2"
  }},
  "response": "<message to user>"
}}

Rules you must strictly follow:
1. If you do not have enough information to call a function, ask the user for the missing details in the "response" field and leave "function" and "arguments" empty.
2. Before executing any trade (buy/sell), explicitly ask the user for confirmation (example: "Please confirm if you would like to proceed with buying X quantity of Y at Z price. Reply Yes to confirm.").
3. Never assume or hallucinate. If a tool does not exist for an action the user asks, politely explain it in the "response" and do NOT invent a function call.
4. Only call one function at a time. After a function returns, you can decide if more action is needed.
5. Always make sure the user has sufficient balance before placing an order.
6. Think carefully before deciding to call a function. If unsure, first clarify with the user.
7. MAKE SURE TO READ ALL THE CONVERSATION DATA BEFORE CALLING FOR A FUNCTION AGAIN. THE DATA MIGHT ALREADY BE PRESENT.

If you understand the user's intent and have all required information, respond with a tool call.  
If not, ask the user for clarification without making any function call.

Never, under any circumstances, output anything except the specified JSON structure.

In case you need it, here are the company name to instrument keys mappings: {INSTRUMENT_KEYS}.


"""

# ----------------------------------------------
# Global Per-Agent Conversation Store (Per User)
# ----------------------------------------------

last_stock_data_context = {}  # Stores last data context per user

def get_or_create_session(agent_type, user_id, company_name):
    if company_name is None:
        company_name = "general"  # Use a default company name for general conversations
        
    if agent_type not in user_conversations:
        user_conversations[agent_type] = {}
    
    if user_id not in user_conversations[agent_type]:
        user_conversations[agent_type][user_id] = {}
        
    if company_name not in user_conversations[agent_type][user_id]:
        user_conversations[agent_type][user_id][company_name] = ChatSession(user_id, company_name)
    
    return user_conversations[agent_type][user_id][company_name]

# ----------------------------------------------
# Agent 1: Stock Price Agent
# ----------------------------------------------

MIN_DATE = "2003-01-01"
MAX_DATE = "2025-04-28"

def check_if_data_required(query, company_name, existing_start=None, existing_end=None):
    existing_range_str = (
        f"We already have stock price data for {company_name} from {existing_start} to {existing_end}."
        if existing_start and existing_end else
        "We do not have any existing stock data."
    )

    system_prompt = f"""
    You are a helpful financial assistant, helping analyze the company {company_name}.

    The user has asked the following query:
    "{query}"

    {existing_range_str}

    Based on this, do we need to fetch **new stock price data** to better answer the query?

    If yes, respond:
    YES

    If the current data is enough or the query doesn't require stock data, respond:
    NO
    """.strip()

    response = query_gemini(query, system_prompt=system_prompt).strip()
    return response.upper().startswith("YES")


def infer_date_range_from_query(query):
    system_prompt = f"""
    You are an intelligent assistant helping extract date ranges for stock price analysis.
    Given a user query, infer a suitable `start_date` and `end_date` for analysis based on user intent.

    Constraints:
    - Available stock data is from {MIN_DATE} to {MAX_DATE}.
    - Use full YYYY-MM-DD format.
    - If no range is specified, default to last 30 days from {MAX_DATE}.
    - Output only in the format:
    START_DATE: <start>
    END_DATE: <end>
    """.strip()
    
    date_response = query_gemini(query, system_prompt=system_prompt)
    try:
        lines = date_response.strip().splitlines()
        start = next(line for line in lines if line.startswith("START_DATE")).split(":")[1].strip()
        end = next(line for line in lines if line.startswith("END_DATE")).split(":")[1].strip()
        return start, end
    except Exception:
        default_start = (datetime.strptime(MAX_DATE, "%Y-%m-%d") - timedelta(days=30)).strftime("%Y-%m-%d")
        return default_start, MAX_DATE

import re

def extract_dates_from_prompt(prompt):
    """
    Extracts start_date and end_date in YYYY-MM-DD format from the given stock context prompt.
    Returns (start_date, end_date) if found, else (None, None).
    """
    if not prompt:
        return None, None

    # Match date ranges in the format 'from YYYY-MM-DD to YYYY-MM-DD'
    match = re.search(r'from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})', prompt)
    if match:
        start_date, end_date = match.groups()
        return start_date, end_date

    return None, None

def stock_price_agent(user_id, company_name, query):
    session = get_or_create_session("stock_agent", user_id, company_name)
    session.add_message("user", query)
    
    needs_data = True

    if needs_data:
        start_date, end_date = infer_date_range_from_query(query)
        df = get_stock_price_range_tool(company_name, start_date, end_date)
        if df.empty:
            result = f"No stock data found for {company_name} between {start_date} and {end_date}."
            session.add_message("assistant", result)
            return result

        ohlc_str = df.to_string(index=False)
        last_stock_data_context[(user_id, company_name)] = STOCK_ANALYSIS_SYSTEM_PROMPT.format(
            company=company_name,
            start_date=start_date,
            end_date=end_date,
            ohlc_data=ohlc_str
        )
        conversation_text = f"User: {query}"
        result = query_gemini(system_prompt=last_stock_data_context[(user_id, company_name)], prompts=conversation_text)

    else:
        prior_context = last_stock_data_context.get((user_id, company_name), "")
        conversation_text = session.get_conversation_text()
        result = query_gemini(system_prompt=prior_context, prompts=conversation_text)

    session.add_message("assistant", result)
    return result

# ----------------------------------------------
# Agent 2: Financial Report Agent
# ----------------------------------------------

def financial_metrics_agent(user_id, company_name, query):
    session = get_or_create_session("financial_agent", user_id, company_name)
    session.add_message("user", query)
    
    report = get_company_financials_tool(company=company_name)
    if not report:
        return "No financial data available for this company."

    system_prompt = FINANCIALS_SYSTEM_PROMPT.format(company=company_name, financial_report=report)
    conversation_text = session.get_conversation_text()
    
    result = query_gemini(system_prompt=system_prompt, prompts=conversation_text)
    session.add_message("assistant", result)
    return result

# ----------------------------------------------
# Agent 3: Company Background Agent
# ----------------------------------------------

def company_background_agent(user_id, company_name, query):
    session = get_or_create_session("background_agent", user_id, company_name)
    session.add_message("user", query)
    
    summary = get_company_background_information_tool(company=company_name)
    if not summary:
        result = "No background information available."
        session.add_message("assistant", result)
        return result

    system_prompt = BACKGROUND_SYSTEM_PROMPT.format(company=company_name, company_background=summary)
    conversation_text = session.get_conversation_text()
    
    result = query_gemini(system_prompt=system_prompt, prompts=conversation_text)
    session.add_message("assistant", result)
    return result

# ----------------------------------------------
# Agent 4: Trading Agent (with autonomous reasoning)
# ----------------------------------------------
def trading_agent(user_id, query, company=None, access_token=None):
    if access_token is None:
        return "Access token is required for trading operations."
    if company is None:
        return "Company name is required for trading operations."
    
    session = get_or_create_session("trading_agent", user_id, company)
    session.add_message("user", query)
    
    while True:
        conversation_text = session.get_conversation_text()
        
        agent_reply = query_gemini(system_prompt=TRADING_SYSTEM_PROMPT, prompts=conversation_text)

        try:
            agent_json = to_json(agent_reply)
        except Exception as e:
            session.add_message("assistant", agent_reply)
            return agent_reply

        function_name = agent_json.get("function")
        response_text = agent_json.get("response", "")

        session.add_message("assistant", response_text)

        if function_name in TOOL_DESCRIPTIONS.keys():
            tool_args = agent_json.get("arguments", {})

            try:
                tool_result = call_trading_tools(function_name, tool_args, access_token=access_token)
            except Exception as e:
                tool_result = f"Error performing the action {function_name.replace('_', ' ')} due to {e.message}"
                response_text = tool_result

            session.add_message("user", f"The tool {function_name} returned: {tool_result}. Please summarize the result to the user. Can we reply to the user now or do we need have to make some more tool calls?")
        else:
            break

    return response_text


def call_trading_tools(name, args, **kwargs):
    if name == "view_upstox_account_balance_tool":
        return view_upstox_account_balance_tool(**kwargs)
    elif name == "get_live_market_price_tool":
        return get_live_market_price_tool(**args, **kwargs)
    elif name == "place_upstox_order_tool":
        return place_upstox_order_tool(**args, **kwargs)
    else:
        return f"Unknown tool: {name}"
    
def call_agent(user_id, agent_type, query, company=None, access_token=None):
    if agent_type == "stock_price_agent":
        return stock_price_agent(user_id, company, query)
    elif agent_type == "financial_metrics_agent":
        return financial_metrics_agent(user_id, company, query)
    elif agent_type == "company_background_agent":
        return company_background_agent(user_id, company, query)
    elif agent_type == "trading_agent":
        return trading_agent(user_id, query, company=company, access_token=access_token)
    else:
        return f"Unknown agent type: {agent_type}"


def get_conversation_history(user_id, agent_type, company=None):
    """
    Retrieves conversation history for a specific user, agent, and optionally company.
    Returns a list of messages in the format [{"role": role, "content": content}, ...]
    """
    if company is None:
        company = "general"
        
    if (agent_type in user_conversations and 
        user_id in user_conversations[agent_type] and 
        company in user_conversations[agent_type][user_id]):
        
        session = user_conversations[agent_type][user_id][company]
        return session.messages
    
    return []

def clear_conversation_history(user_id, agent_type=None, company=None):
    """
    Clears conversation history at specified level (all, agent, or company specific)
    """
    if company is None:
        company = "general"
        
    if agent_type is None:
        # Clear all conversations for the user
        for agent in user_conversations:
            user_conversations[agent].pop(user_id, None)
    else:
        if user_id in user_conversations.get(agent_type, {}):
            if company:
                # Clear specific company conversation
                user_conversations[agent_type][user_id].pop(company, None)
            else:
                # Clear all companies for this agent
                user_conversations[agent_type].pop(user_id, None)

MASTER_AGENT_PROMPT = """
    You are an AI agent that helps users with stock trading and financial analysis, helping them make more informed decisions.
    You are a master agent that ask multiple agents at your disposal, and based on the user query, you will delegate which agent to call. If you feel you solve the query yourself, do so.

    Type of Agents
    1. Stock Price Agent - Read past stock data for a company and answer questions accordingly
    2. Financial Report Agent - Read past financial data for a company and answer questions accordingly
    3. Company Background Agent - Read past company background information and answer questions accordingly
    4. Upstox Trading Agent - Handles tasks related to viewing the LIVE MARKET PRICE of a company and making trades/view account details on the Upstox platform on behalf of the user

    Always respond in this JSON format:
    {{
        "agent": "<agent_name>",
        "response_to_agent": "<response_to_agent>",
        "response_to_user": "<response_to_user>"
    }}

    If you are delegating to a specific agent, include the agent name. Otherwise leave it blank.
    response_to_agent field is the query which will be sent to the agent.
    response_to_user field is the response you will give to the user if you are not delegating to any agent.
    Agent names are: stock_price_agent, financial_metrics_agent, company_background_agent, trading_agent. These agent names should only be used in agent field.
    
    NOTE:
    1. IF YOU ARE DELEGATING TO AN AGENT, THEN response_to_user FIELD DOESN'T NEED TO BE FILLED, LEAVE IT BLANK. ONLY ADD SOME VALUE IN IT IF YOU ARE NOT DELEGATING TO AN AGENT.
    2. MAKE SURE YOU RELAY THE CORRECT INFORMATION FROM THE USER INPUT QUERY TO THE AGENT. THE AGENTS ARE ALSO AI ASSISTANTS TO HELP YOU ANSWER QUESTIONS.
"""

def master_agent(user_id, query, news=None, movement_prediction=None, explanation=None, company=None, access_token=None):
    session = get_or_create_session("master_agent", user_id, company)
    session.add_message("user", query)
    
    additional_prompt = ""
    if news and movement_prediction and explanation:
        additional_prompt = f"""
        Prior to calling you, the user has already analysed from another AI assistant the impact of news: \n {news} \n on company {company} \n
        The predicted movement of stock is: \n {movement_prediction} \n
        The explanation provided is: \n {explanation} \n
        You can use this information to better answer the user's query or to delegate to the right agent with this extra information.
        """

    system_prompt = MASTER_AGENT_PROMPT + additional_prompt

    result = query_gemini(system_prompt=system_prompt, prompts=session.get_conversation_text())

    try:
        result_json = to_json(result)
        agent_name = result_json.get("agent")
        response_to_agent = result_json.get("response_to_agent", "")
        response_to_user = result_json.get("response_to_user", "")

        print(f"Agent Name: {agent_name}")
        print(f"Response to Agent: {response_to_agent}")
        print(f"Response to User: {response_to_user}")

        if agent_name:
            result = call_agent(user_id, agent_name, response_to_agent, company, access_token=access_token)
            session.add_message("assistant", result)
            return result
        else:
            session.add_message("assistant", response_to_user)
            return response_to_user
    
    except Exception as e:
        error_msg = f"Error processing query: {str(e)}"
        session.add_message("assistant", error_msg)
        return error_msg

if __name__ == "__main__":

    print("Welcome to the Master Agent!")
    user_id = "terminal_user"
    company_name = "INFY"
    query = ""

    while True:
        print("\nOptions:")
        print("1. Enter a query")
        print("2. View conversation history")
        print("3. Exit")
        choice = input("Enter your choice (1/2/3): ").strip()

        if choice == "1":
            query = input("Enter your query: ").strip()
            response = master_agent(user_id, query, company=company_name, access_token="your_access_token_here")
            print("Final Response")
            print(response)
        elif choice == "2":
            print("\nAvailable Agents:")
            print("1. Stock Price Agent")
            print("2. Financial Report Agent")
            print("3. Company Background Agent")
            print("4. Trading Agent")
            print("5. Master Agent")
            agent_choice = input("Select an agent to view history (1-5): ").strip()

            agent_map = {
                "1": "stock_agent",
                "2": "financial_agent",
                "3": "background_agent",
                "4": "trading_agent",
                "5": "master_agent"
            }

            agent_type = agent_map.get(agent_choice)
            if agent_type:
                history = get_conversation_history(user_id, agent_type, company_name)
                if history:
                    print("\nConversation History:")
                    for msg in history:
                        print(f"{msg['role']}: {msg['content']}")
                else:
                    print("No conversation history found for the selected agent.")
            else:
                print("Invalid agent selection.")
        elif choice == "3":
            print("Exiting. Goodbye!")
            break
        else:
            print("Invalid choice. Please try again.")  