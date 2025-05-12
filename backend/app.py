# Import necessary modules
import asyncio
from datetime import datetime, timedelta
import json
import os
import ssl
import requests
import upstox_client
import websockets
from google.protobuf.json_format import MessageToDict
from dotenv import load_dotenv

from agents import clear_conversation_history, get_conversation_history, master_agent
from fetch_stock_price_data_utils import get_stock_price
from fingreat import fetch_financials, generate_factors, generate_timeseries_nlp_representations_for_examples, get_knowledge_graph_summary, get_nifty50_companies_from_news_stocks, get_nlp_representation_last_n_working_days, get_other_day_stock, search_similar_news, to_json
from llm_calls import query_gemini
from similarity_search import load_resources
from templates import FEW_SHOT_PROMPT_EXAMPLES_TEMPLATE, FEW_SHOT_PROMPT_TEMPLATE
load_dotenv()
from upstox_client.feeder.proto import MarketDataFeed_pb2 as pb
from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from fetch_latest_price_for_csv import fetch_price_for_company

from templates import (
    FEW_SHOT_PROMPT_TEMPLATE,
    FEW_SHOT_PROMPT_EXAMPLES_TEMPLATE,
    FEW_SHOT_PROMPT_TEMPLATE_END,
    COMPANY_FINANCIALS_PROMPT_TEMPLATE,
    REFINE_DECISION_PROMPT_TEMPLATE_1,
    REFINE_DECISION_PROMPT_TEMPLATE_2,
    KG_NODES_MAPPING,
    INSTRUMENT_KEYS,
    INVERSE_INSTRUMENT_KEYS
)


load_resources()
# Initialize Flask app
app = Flask(__name__)
CORS(app)  # This enables CORS for all routes

# Global variable to store market data
market_data = {}

# Initialize access_tokens dictionary before defining routes
access_tokens = {}

def get_market_data_feed_authorize(api_version, configuration):
    """Get authorization for market data feed."""
    api_instance = upstox_client.WebsocketApi(
        upstox_client.ApiClient(configuration))
    api_response = api_instance.get_market_data_feed_authorize(api_version)
    return api_response

def decode_protobuf(buffer):
    """Decode protobuf message."""
    feed_response = pb.FeedResponse()
    feed_response.ParseFromString(buffer)
    return feed_response

async def fetch_market_data_loop():
    """Background task to continuously fetch market data."""
    global market_data
    
    # Create default SSL context
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    # Configure OAuth2 access token for authorization
    configuration = upstox_client.Configuration()
    api_version = '2.0'
    configuration.access_token = os.getenv("UPSTOX_ACCESS_TOKEN")

    while True:
        try:
            # Get market data feed authorization
            response = get_market_data_feed_authorize(api_version, configuration)
            
            # Connect to the WebSocket with SSL context
            async with websockets.connect(response.data.authorized_redirect_uri, ssl=ssl_context) as websocket:
                print('Connection established')

                await asyncio.sleep(1)  # Wait for 1 second
                keys = list(INSTRUMENT_KEYS.values())
                # Data to be sent over the WebSocket
                data = {
                    "guid": "someguid",
                    "method": "sub",
                    "data": {
                        "mode": "ltpc",
                        "instrumentKeys": keys
                    }
                }

                # Convert data to binary and send over WebSocket
                binary_data = json.dumps(data).encode('utf-8')
                await websocket.send(binary_data)
                
                print(f"Subscribed to {len(keys)} instruments")

                # Continuously receive and decode data from WebSocket
                while True:
                    message = await websocket.recv()
                    decoded_data = decode_protobuf(message)

                    # Convert the decoded data to a dictionary
                    data_dict = MessageToDict(decoded_data)
                    
                    # Process market data
                    if "feeds" in data_dict:
                        for instrument_key, feed_data in data_dict["feeds"].items():
                            if "ltpc" in feed_data:
                                # Get symbol from inverse mapping
                                symbol = INVERSE_INSTRUMENT_KEYS.get(instrument_key, instrument_key)
                                
                                # Extract price data
                                ltpc_data = feed_data["ltpc"]
                                ltp = float(ltpc_data.get("ltp", 0))
                                cp = float(ltpc_data.get("cp", 0))
                                
                                # Calculate percent change
                                percent_change = 0
                                if cp > 0:
                                    percent_change = round(((ltp - cp) * 100 / cp), 2)
                                
                                # Store in global market data
                                market_data[symbol] = {
                                    "price": ltp,
                                    "change": round(ltp-cp, 2),
                                    "percentage_change": percent_change
                                }
        
        except Exception as e:
            print(f"Error in WebSocket connection: {e}")
            # Wait before reconnecting
            await asyncio.sleep(5)

# Flask routes
@app.route('/market_prices', methods=['GET'])
def get_market_prices():
    """Endpoint to get all market prices."""
    return jsonify(market_data)

@app.route('/market_price/<symbol>', methods=['GET'])
def get_symbol_price(symbol):
    """Endpoint to get price for a specific symbol."""
    symbol = symbol.upper()
    if symbol in market_data:
        return jsonify(market_data[symbol])
    else:
        return jsonify({"error": "Symbol not found"}), 404

# Background task starter
def start_background_task():
    """Start the background market data fetching."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(fetch_market_data_loop())


@app.route('/process_news', methods=['POST'])
def process_news():
    data = request.get_json()
    news_article = data['news_article']
    company_ticker = data['company_ticker']
    date_of_publish = data['date_of_publish']
    index = data.get('index', 0)

    def generate():
        # Initial message
        status = {
            "stage": 0,
            "message": "Analysing your financial news",
            "total_stages": 9
        }
        yield json.dumps(status) + "\n"
        
        # Step 1: Fetching similar articles
        status = {
            "stage": 1,
            "message": "Looking at similar events in the past",
            "total_stages": 9
        }
        yield json.dumps(status) + "\n"
        
        similar_articles = search_similar_news(news_article)
        
        status["message"] = f"Retrieved {len(similar_articles)} similar articles for comparative study"
        yield json.dumps(status) + "\n"

        similar_articles = sorted(similar_articles, key=lambda x: x["score"], reverse=True)[:3]
        filtered_articles = [
            (article["article_title"], article["article_description"], article["article_stocks"], article["article_date"])
            for article in similar_articles
        ]

        # Step 2: Generating examples
        status = {
            "stage": 2,
            "message": "Analysing how market reacted to similar past events",
            "total_stages": 9
        }
        yield json.dumps(status) + "\n"
        
        few_shot_prompt_examples = ""
        for article in filtered_articles:
            date = article[3]
            nifty_50_companies = get_nifty50_companies_from_news_stocks(article[2])
            for company in nifty_50_companies:
                stock_price_last_working_day = get_other_day_stock(company, date, True)
                stock_price_that_day = get_stock_price(company, date)
                stock_price_next_working_day = get_other_day_stock(company, date, False)

                stock_movement_info = generate_timeseries_nlp_representations_for_examples(
                    stock_price_last_working_day, stock_price_that_day, stock_price_next_working_day
                )

                factors = generate_factors(article[0] + ". " + article[1], company)
                factor_str = " | ".join(factors)

                few_shot_prompt_examples += FEW_SHOT_PROMPT_EXAMPLES_TEMPLATE.format(company, factor_str, stock_movement_info)
        
        status["message"] = "Huh, that took a while, but I've analysed past events"
        yield json.dumps(status) + "\n"
        

        # Step 3: Creating the prompt
        status = {
            "stage": 3,
            "message": "Thinking on how your news will impact the market",
            "total_stages": 9
        }
        yield json.dumps(status) + "\n"
        
        few_shot_prompt = FEW_SHOT_PROMPT_TEMPLATE.format(KG_NODES_MAPPING[company_ticker], few_shot_prompt_examples)
        news_factors = generate_factors(news_article, KG_NODES_MAPPING[company_ticker])
        news_factors = "| ".join(news_factors)
        few_shot_prompt += FEW_SHOT_PROMPT_TEMPLATE_END.format(news_factors)

        # Step 4: Initial market impact analysis
        status = {
            "stage": 4,
            "message": "Ahh, things makes sense to me now",
            "total_stages": 9
        }
        few_shot_prompt_response = to_json(query_gemini(few_shot_prompt))
        
        yield json.dumps(status) + "\n"
        
        
        # Step 5: Knowledge graph analysis
        status = {
            "stage": 5,
            "message": "Let me gather some background knowledge about the company",
            "total_stages": 9
        }
        
        yield json.dumps(status) + "\n"
        knowledge_graph_summary = get_knowledge_graph_summary(news_article, company_ticker)

        # Step 6: Financial analysis
        status = {
            "stage": 6,
            "message": "Let me now look at some financial metrics of the company",
            "total_stages": 9
        }
        
        yield json.dumps(status) + "\n"
        financials = fetch_financials(company_ticker)
        company_financials_prompt = COMPANY_FINANCIALS_PROMPT_TEMPLATE.format(financials)
        financial_analysis_response = to_json(query_gemini(company_financials_prompt))

        # Step 7: First refinement
        status = {
            "stage": 7,
            "message": "That's a lot of data, let's see how can we put it all together",
            "total_stages": 9
        }
        yield json.dumps(status) + "\n"
        
        refine_decision_prompt_1 = REFINE_DECISION_PROMPT_TEMPLATE_1.format(
            news_factors,
            few_shot_prompt_response["result"],
            few_shot_prompt_response["explanation"],
            knowledge_graph_summary,
            financial_analysis_response
        )
        refine_decision_prompt_response_1 = to_json(query_gemini(refine_decision_prompt_1))

        # Step 8: Time series
        status = {
            "stage": 8,
            "message": "Let's analyse how your stock is performing over the last week",
            "total_stages": 9
        }
        yield json.dumps(status) + "\n"
        
        company_stock_timeseries_representation = get_nlp_representation_last_n_working_days(company_ticker, date_of_publish)

        # Step 9: Final refinement
        status = {
            "stage": 9,
            "message": "Great! Generating my final verdict...",
            "total_stages": 9
        }
        yield json.dumps(status) + "\n"
        
        refine_decision_prompt_2 = REFINE_DECISION_PROMPT_TEMPLATE_2.format(
            news_factors,
            refine_decision_prompt_response_1["result"],
            refine_decision_prompt_response_1["explanation"],
            company_stock_timeseries_representation
        )
        refine_decision_prompt_response_2 = to_json(query_gemini(refine_decision_prompt_2))

        yield json.dumps(refine_decision_prompt_response_2) + "\n"

    return Response(stream_with_context(generate()), mimetype='application/json')


#date in YYYY-MM-DD format
@app.route('/time_series_price', methods=['GET'])
def get_time_series_price():
    company = request.args.get('company')
    from_date = request.args.get('from_date')
    to_date = request.args.get('to_date')
    return fetch_price_for_company(company, from_date, to_date)

@app.route('/<user_id>/<company_ticker>/agents/<agent_name>/conversations', methods=['GET'])
def get_conversations(user_id, company_ticker, agent_name):
    conversations = get_conversation_history(user_id, agent_name, company_ticker)
    return jsonify(conversations)

@app.route('/<user_id>/<company_ticker>/agents/<agent_name>/conversations', methods=['DELETE'])
def clear_conversations(user_id, company_ticker,agent_name):
    clear_conversation_history(user_id, agent_name, company_ticker)
    return jsonify({"message": "Conversations cleared successfully"}), 200


@app.route('/<user_id>/<company_ticker>/agents/master_agent', methods=['POST'])
def query_master_agent(user_id, company_ticker):
    data = request.get_json()

    print(data)
    
    movement_prediction, explanation, news = (data.get('movement_prediction', None), data.get('explanation', None), data.get('news', None))
    if (movement_prediction is None or explanation is None or news is None) and not (movement_prediction is None and explanation is None and news is None):
        return jsonify({"error": "Either provide all of movement_prediction, explanation, and news, or none of them"}), 400
    
    company = company_ticker
    
    query = data.get('query', None)
    if not query:
        return jsonify({"error": "Please send user query"}), 400
    
    access_token = access_tokens.get(user_id, {}).get('access_token')
    
    if not access_token or access_tokens.get(user_id, {}).get('expires_at') < datetime.now():
        return "User not signed in, access token expired", 401
    
    response = master_agent(user_id, query, movement_prediction = movement_prediction, explanation = explanation, news=news, company = company, access_token = access_token)
    return response

# save access token per user
@app.route('/upstox/save_access_token', methods=['POST'])
def save_access_token():
    data = request.get_json()
    access_token = data.get('access_token')
    user_id = data.get('user_id')
    if not access_token or not user_id:
        return jsonify({"error": "Missing access token or user ID"}), 400

    access_tokens[user_id] = {
        "access_token": access_token,
        "expires_at": (datetime.now().replace(hour=3, minute=30, second=0, microsecond=0) 
                       + timedelta(days=1) if datetime.now().hour >= 3 else datetime.now().replace(hour=3, minute=30, second=0, microsecond=0))
    }

    return jsonify({"message": "Access token saved successfully"}), 200

@app.route('/upstox/user_signed_in', methods=['GET'])
def is_signed_in():
    user_id = request.args.get('user_id')
    print(f"Checking sign-in status for user_id: {user_id}")  # Debug log
    print(access_tokens)
    if not user_id or user_id not in access_tokens:
        return jsonify({"is_signed_in": False}), 200

    token_info = access_tokens[user_id]
    if datetime.now() >= token_info["expires_at"]:
        return jsonify({"is_signed_in": False}), 200

    return jsonify({"is_signed_in": True}), 200

@app.route('/upstox/logout', methods=['GET'])
def logout():
    user_id = request.args.get('user_id')
    if not user_id or user_id not in access_tokens:
        return jsonify({"error": "User not signed in"}), 400

    url = "https://api.upstox.com/v2/logout"
    
    payload={}
    
    headers = {
        "Authorization": f"Bearer {access_tokens[user_id]['access_token']}",
        'Accept': 'application/json'
    }

    response = requests.request("DELETE", url, headers=headers, data=payload)
    
    if response.status_code != 200:
        return jsonify({"error": "Failed to log out"}), 500
    
    del access_tokens[user_id]
    
    return jsonify({"message": "Logged out successfully"}), 200


@app.route('/', methods=['GET'])
def index():
    return "Welcome to FinGReaT!"

if __name__ == '__main__':
    # Start the market data fetcher in a background thread
    import threading
    background_thread = threading.Thread(target=start_background_task)
    background_thread.daemon = True
    background_thread.start()
    
    # Start the Flask application
    app.run(debug=True, host='0.0.0.0', port=8000)


