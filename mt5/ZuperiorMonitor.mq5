#property strict
#property version "1.00"
#property description "Zuperior Trading Arena - read-only MT5 demo account monitor"

input string ApiBaseUrl = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/mt5-ingest";
input string ConnectorToken = "PASTE_UNIQUE_CONNECTOR_TOKEN_HERE";
input int PollSeconds = 10;
input int HistoryDays = 3;

string JsonEscape(string value) {
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", " ");
   StringReplace(value, "\n", " ");
   return value;
}
string Num(double value, int digits=2) { return DoubleToString(value, digits); }

string BuildPayload() {
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string server = AccountInfoString(ACCOUNT_SERVER);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string payload = "{\"schema_version\":1,\"account\":{";
   payload += "\"login\":\"" + IntegerToString(login) + "\",";
   payload += "\"server\":\"" + JsonEscape(server) + "\",";
   payload += "\"is_demo\":" + (mode == ACCOUNT_TRADE_MODE_DEMO ? "true" : "false") + ",";
   payload += "\"currency\":\"" + JsonEscape(currency) + "\",";
   payload += "\"balance\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE)) + ",";
   payload += "\"equity\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY)) + ",";
   payload += "\"margin\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN)) + ",";
   payload += "\"free_margin\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN_FREE));
   payload += "},\"positions\":[";

   bool first = true;
   for(int i=0; i<PositionsTotal(); i++) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!first) payload += ",";
      first = false;
      payload += "{";
      payload += "\"ticket\":\"" + IntegerToString((long)ticket) + "\",";
      payload += "\"symbol\":\"" + JsonEscape(PositionGetString(POSITION_SYMBOL)) + "\",";
      payload += "\"type\":\"" + (PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY ? "BUY" : "SELL") + "\",";
      payload += "\"volume\":" + Num(PositionGetDouble(POSITION_VOLUME), 4) + ",";
      payload += "\"price_open\":" + Num(PositionGetDouble(POSITION_PRICE_OPEN), 8) + ",";
      payload += "\"price_current\":" + Num(PositionGetDouble(POSITION_PRICE_CURRENT), 8) + ",";
      payload += "\"stop_loss\":" + Num(PositionGetDouble(POSITION_SL), 8) + ",";
      payload += "\"take_profit\":" + Num(PositionGetDouble(POSITION_TP), 8) + ",";
      payload += "\"profit\":" + Num(PositionGetDouble(POSITION_PROFIT)) + ",";
      payload += "\"time\":" + IntegerToString((long)PositionGetInteger(POSITION_TIME));
      payload += "}";
   }
   payload += "],\"deals\":[";

   first = true;
   datetime toTime = TimeCurrent();
   datetime fromTime = toTime - (HistoryDays * 86400);
   if(HistorySelect(fromTime, toTime)) {
      int total = HistoryDealsTotal();
      int begin = MathMax(0, total - 500);
      for(int i=begin; i<total; i++) {
         ulong ticket = HistoryDealGetTicket(i);
         if(ticket == 0) continue;
         long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
         bool balanceOp = (type == DEAL_TYPE_BALANCE || type == DEAL_TYPE_CREDIT || type == DEAL_TYPE_CHARGE);
         if(!first) payload += ",";
         first = false;
         payload += "{";
         payload += "\"ticket\":\"" + IntegerToString((long)ticket) + "\",";
         payload += "\"order_ticket\":\"" + IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_ORDER)) + "\",";
         payload += "\"position_id\":\"" + IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_POSITION_ID)) + "\",";
         payload += "\"symbol\":\"" + JsonEscape(HistoryDealGetString(ticket, DEAL_SYMBOL)) + "\",";
         payload += "\"deal_type\":\"" + IntegerToString(type) + "\",";
         payload += "\"entry_type\":\"" + IntegerToString(HistoryDealGetInteger(ticket, DEAL_ENTRY)) + "\",";
         payload += "\"volume\":" + Num(HistoryDealGetDouble(ticket, DEAL_VOLUME), 4) + ",";
         payload += "\"price\":" + Num(HistoryDealGetDouble(ticket, DEAL_PRICE), 8) + ",";
         payload += "\"profit\":" + Num(HistoryDealGetDouble(ticket, DEAL_PROFIT)) + ",";
         payload += "\"commission\":" + Num(HistoryDealGetDouble(ticket, DEAL_COMMISSION)) + ",";
         payload += "\"swap\":" + Num(HistoryDealGetDouble(ticket, DEAL_SWAP)) + ",";
         payload += "\"comment\":\"" + JsonEscape(HistoryDealGetString(ticket, DEAL_COMMENT)) + "\",";
         payload += "\"time\":" + IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_TIME)) + ",";
         payload += "\"is_balance_operation\":" + (balanceOp ? "true" : "false");
         payload += "}";
      }
   }
   payload += "]}";
   return payload;
}

void SendSnapshot() {
   if(ConnectorToken == "" || StringFind(ConnectorToken, "PASTE_") == 0 || StringFind(ApiBaseUrl, "YOUR_PROJECT_REF") >= 0) {
      Print("Configure ApiBaseUrl and ConnectorToken before connecting.");
      return;
   }
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ConnectorToken + "\r\n";
   char data[], result[];
   string resultHeaders;
   string body = BuildPayload();
   int count = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(count > 0) ArrayResize(data, count - 1);
   ResetLastError();
   int status = WebRequest("POST", ApiBaseUrl, headers, 8000, data, result, resultHeaders);
   if(status == -1) {
      Print("WebRequest failed. Add the Supabase host under MT5 Tools > Options > Expert Advisors > Allow WebRequest. Error=", GetLastError());
      return;
   }
   string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(status < 200 || status >= 300) Print("Arena API rejected update. HTTP ", status, ": ", response);
   else Print("Arena snapshot sent. HTTP ", status);
}

int OnInit() {
   if(PollSeconds < 5) PollSeconds = 5;
   EventSetTimer(PollSeconds);
   Print("Zuperior monitor started. This EA does not place, modify or close trades.");
   SendSnapshot();
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { SendSnapshot(); }
void OnTick() { }
