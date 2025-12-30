/*
  ARQUIVO: ControlePortao.ino
  DESCRIÇÃO: Firmware GateOS Pro - Configurado para HiveMQ Cloud
  ATUALIZAÇÃO: Formulário HTML com valores preenchidos e campos readonly
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <Preferences.h>
#include <PubSubClient.h>

// --- HARDWARE ---
#define PINO_RELE_REAL 18
#define PINO_FANTASMA 23
#define PINO_SENSOR 4
#define PINO_LED 2
#define PINO_RESET_CONFIG 0

WebServer server(80);
Preferences preferences;
WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- DADOS PADRÃO (Define os valores iniciais) ---
// Wi-Fi Padrão (Será substituído se houver config salva)
String ssid_str = "LUIZ_2Ghz"; 
String pass_str = "Luizgustavo@07";

// HiveMQ Padrão
String mqtt_server_str = "e7ed4f597a2e4552bff29de8b6dba0d8.s1.eu.hivemq.cloud";
String mqtt_user_str = "AdminGateOS";
String mqtt_pass_str = "6A1EAa40180C5A4399E6B1E89DAB79728F5E1DE9F777739462AD2331E8B3BF383";

// Senha de Ativação do Dispositivo Padrão
String device_code_str = "1234"; 

String deviceID;
String topic_cmd;
String topic_status;
bool emModoConfig = false;
bool estadoSensorAnterior = false;

String getDeviceID() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  return mac;
}

void setup() {
  Serial.begin(115200);
  deviceID = getDeviceID();
  
  pinMode(PINO_RELE_REAL, INPUT); 
  pinMode(PINO_FANTASMA, OUTPUT); digitalWrite(PINO_FANTASMA, LOW);
  pinMode(PINO_SENSOR, INPUT_PULLUP);
  pinMode(PINO_LED, OUTPUT);
  pinMode(PINO_RESET_CONFIG, INPUT_PULLUP);

  topic_cmd = "gate/" + deviceID + "/cmd";
  topic_status = "gate/" + deviceID + "/status";

  // Carrega configurações se existirem (sobrescreve os padrões acima)
  preferences.begin("gate_config", false);

  if (digitalRead(PINO_RESET_CONFIG) == LOW) {
    Serial.println("Resetando Configs...");
    for(int i=0; i<10; i++) { digitalWrite(PINO_LED, !digitalRead(PINO_LED)); delay(100); }
    preferences.clear();
    ESP.restart();
  }

  // Se já tiver config salva, usa a salva. Se não, usa as hardcoded acima.
  if(preferences.getString("ssid", "") != "") {
      ssid_str = preferences.getString("ssid", "");
      pass_str = preferences.getString("pass", "");
      // Carrega MQTT e Code se existirem, senão mantem o padrão
      if(preferences.getString("mqtt_server", "") != "") mqtt_server_str = preferences.getString("mqtt_server", "");
      if(preferences.getString("mqtt_user", "") != "") mqtt_user_str = preferences.getString("mqtt_user", "");
      if(preferences.getString("mqtt_pass", "") != "") mqtt_pass_str = preferences.getString("mqtt_pass", "");
      if(preferences.getString("dev_code", "") != "") device_code_str = preferences.getString("dev_code", "");
  }

  Serial.println("--- GATE OS ---");
  Serial.println("ID: " + deviceID);
  Serial.println("Senha de Ativacao: " + device_code_str);

  // Tenta conectar direto. Se falhar muito, abre o AP.
  setupModoOperacao();
}

void loop() {
  if (emModoConfig) {
    server.handleClient();
  } else {
    if (!client.connected()) reconnectMQTT();
    client.loop();
    verificarSensor();
  }
}

// --- MODO CONFIGURAÇÃO (AP + FORMULÁRIO PREENCHIDO) ---
void setupModoConfiguracao() {
  emModoConfig = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(("SETUP_GATE_" + deviceID).c_str(), "12345678");

  server.on("/", HTTP_GET, []() {
    String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'>";
    // CSS: input[readonly] fica cinza para indicar que não pode editar
    html += "<style>body{font-family:sans-serif;padding:20px;background:#f4f4f4} .card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1);max-width:400px;margin:auto} input{width:100%;padding:10px;margin:5px 0;border:1px solid #ddd;border-radius:4px;box-sizing:border-box} input[readonly]{background-color:#e9ecef;color:#6c757d;cursor:not-allowed} button{width:100%;padding:12px;background:#007bff;color:white;border:none;border-radius:4px;font-size:16px;margin-top:15px;cursor:pointer}</style>";
    html += "</head><body><div class='card'><h2>Configurar GateOS</h2>";
    html += "<p><b>ID do Dispositivo:</b> " + deviceID + "</p>";
    
    html += "<form action='/save' method='POST'>";
    
    // 1. Configurações do Cliente (Editáveis e Preenchidas)
    html += "<h3>Segurança</h3>";
    html += "<label>Senha de Ativação:</label>";
    html += "<input type='text' name='dev_code' value='" + device_code_str + "'>";
    
    html += "<h3>Conexão Wi-Fi</h3>";
    html += "<label>Nome da Rede (SSID):</label>";
    html += "<input type='text' name='ssid' value='" + ssid_str + "'>";
    
    html += "<label>Senha da Rede:</label>";
    html += "<input type='password' name='pass' value='" + pass_str + "'>";
    
    // 2. Configurações do Sistema (Apenas Leitura / Readonly)
    html += "<hr><h3>Sistema (Bloqueado)</h3>";
    html += "<label>Servidor MQTT:</label>";
    html += "<input type='text' name='mqtt_server' value='" + mqtt_server_str + "' readonly>";
    
    html += "<label>Usuário MQTT:</label>";
    html += "<input type='text' name='mqtt_user' value='" + mqtt_user_str + "' readonly>";
    
    // Senha MQTT oculta mas enviada, ou readonly se quiser mostrar
    // html += "<input type='password' name='mqtt_pass' value='" + mqtt_pass_str + "' readonly>"; 
    
    html += "<button type='submit'>SALVAR E REINICIAR</button>";
    html += "</form></div></body></html>";
    server.send(200, "text/html", html);
  });

  server.on("/save", HTTP_POST, []() {
    if (server.arg("ssid").length() > 0) {
      preferences.putString("ssid", server.arg("ssid"));
      preferences.putString("pass", server.arg("pass"));
      
      // Salva o código de ativação se foi alterado
      if(server.arg("dev_code").length() > 0) preferences.putString("dev_code", server.arg("dev_code"));
      
      // Salva MQTT (mesmo sendo readonly, o form envia o value)
      if(server.arg("mqtt_server").length() > 0) preferences.putString("mqtt_server", server.arg("mqtt_server"));
      if(server.arg("mqtt_user").length() > 0) preferences.putString("mqtt_user", server.arg("mqtt_user"));
      
      server.send(200, "text/html", "<h1>Configuração Salva!</h1><p>O dispositivo irá reiniciar e conectar na nova rede.</p>");
      delay(2000);
      ESP.restart();
    }
  });
  server.begin();
}

void setupModoOperacao() {
  emModoConfig = false;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid_str.c_str(), pass_str.c_str());

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 25) { // Tenta por ~12 segs
    delay(500); digitalWrite(PINO_LED, !digitalRead(PINO_LED)); 
    tentativas++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PINO_LED, HIGH);
    espClient.setInsecure(); // Necessário para HiveMQ
    client.setServer(mqtt_server_str.c_str(), 8883);
    client.setCallback(callbackMQTT);
  } else {
    setupModoConfiguracao(); // Falhou WiFi, abre AP
  }
}

void reconnectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  // Conecta usando o ID do dispositivo
  if (client.connect(deviceID.c_str(), mqtt_user_str.c_str(), mqtt_pass_str.c_str())) {
      client.subscribe(topic_cmd.c_str());
      publicarStatus();
  } else {
      delay(5000);
  }
}

void callbackMQTT(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for(int i=0; i<length; i++) msg += (char)payload[i];
  
  // Espera formato: "SENHA:COMANDO"
  int separator = msg.indexOf(':');
  if (separator == -1) return;

  String code = msg.substring(0, separator);
  String cmd = msg.substring(separator + 1);

  if (code == device_code_str) {
      if (cmd == "ABRIR_PORTAO_AGORA") {
         String st = (digitalRead(PINO_SENSOR) == LOW) ? "ABRINDO..." : "FECHANDO...";
         client.publish(topic_status.c_str(), st.c_str(), true);
         acionarRele();
      }
  }
}

void acionarRele() {
  pinMode(PINO_RELE_REAL, OUTPUT);
  digitalWrite(PINO_RELE_REAL, HIGH); delay(50);
  digitalWrite(PINO_RELE_REAL, LOW);  delay(500); 
  digitalWrite(PINO_RELE_REAL, HIGH); delay(50);
  pinMode(PINO_RELE_REAL, INPUT);
}

void verificarSensor() {
  int leitura = digitalRead(PINO_SENSOR);
  if (leitura != estadoSensorAnterior) {
    delay(50);
    if (digitalRead(PINO_SENSOR) == leitura) {
      estadoSensorAnterior = leitura;
      publicarStatus();
    }
  }
}

void publicarStatus() {
  String s = (estadoSensorAnterior == HIGH) ? "ESTADO_REAL_ABERTO" : "ESTADO_REAL_FECHADO";
  client.publish(topic_status.c_str(), s.c_str(), true);
}