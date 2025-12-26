/*
  ARQUIVO: firmware.ino
  DESCRIÇÃO: ESP32 Smart Gate - Auto Discovery & Serial Number
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
#define PINO_RESET_CONFIG 0 // Botão BOOT

// --- OBJETOS ---
WebServer server(80);
Preferences preferences;
WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- VARIÁVEIS ---
String deviceID; // O Serial Number (MAC Address limpo)
String ssid_str, pass_str;
String mqtt_server_str, mqtt_user_str, mqtt_pass_str;

// Tópicos Dinâmicos
String topic_cmd;
String topic_status;

bool emModoConfig = false;
bool estadoSensorAnterior = false;

// --- FUNÇÃO AUXILIAR: GERAR SERIAL NUMBER ---
String getDeviceID() {
  String mac = WiFi.macAddress();
  mac.replace(":", ""); // Remove os dois pontos (virá algo como A1B2C3D4E5)
  return mac;
}

void setup() {
  Serial.begin(115200);
  deviceID = getDeviceID(); // Gera o ID Único
  
  // Configurações de Pinos
  pinMode(PINO_RELE_REAL, INPUT); 
  pinMode(PINO_FANTASMA, OUTPUT); digitalWrite(PINO_FANTASMA, LOW);
  pinMode(PINO_SENSOR, INPUT_PULLUP);
  pinMode(PINO_LED, OUTPUT);
  pinMode(PINO_RESET_CONFIG, INPUT_PULLUP);

  // Define tópicos baseados no ID (Independente de Wi-Fi)
  // Ex: gate/A1B2C3D4E5/cmd
  topic_cmd = "gate/" + deviceID + "/cmd";
  topic_status = "gate/" + deviceID + "/status";

  // Memória Permanente
  preferences.begin("gate_config", false);

  // Reset Físico (Segurar BOOT ao ligar)
  if (digitalRead(PINO_RESET_CONFIG) == LOW) {
    Serial.println("Resetando Configurações...");
    preferences.clear();
    for(int i=0; i<5; i++) { digitalWrite(PINO_LED, HIGH); delay(100); digitalWrite(PINO_LED, LOW); delay(100); }
  }

  // Carrega Credenciais
  ssid_str = preferences.getString("ssid", "");
  pass_str = preferences.getString("pass", "");
  mqtt_server_str = preferences.getString("mqtt_server", ""); 
  mqtt_user_str = preferences.getString("mqtt_user", ""); 
  mqtt_pass_str = preferences.getString("mqtt_pass", ""); 

  Serial.println("==================================");
  Serial.println("SERIAL NUMBER (ID): " + deviceID);
  Serial.println("TOPICO CMD: " + topic_cmd);
  Serial.println("==================================");

  if (ssid_str == "" || mqtt_server_str == "") {
    setupModoConfiguracao();
  } else {
    setupModoOperacao();
  }
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

// ================================================================
// MODO CONFIGURAÇÃO (Aqui mostramos o SERIAL NUMBER)
// ================================================================
void setupModoConfiguracao() {
  emModoConfig = true;
  WiFi.mode(WIFI_AP);
  // O nome do WiFi de config também leva o ID para facilitar identificar
  WiFi.softAP(("SETUP_GATE_" + deviceID).c_str(), "12345678");

  Serial.println("[SETUP] AP Iniciado: SETUP_GATE_" + deviceID);

  server.on("/", HTTP_GET, []() {
    String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'>";
    html += "<style>body{font-family:sans-serif;padding:20px;background:#eee} .card{background:#fff;padding:20px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.1)} input{width:100%;padding:10px;margin:5px 0;border:1px solid #ddd;border-radius:4px} .sn-box{background:#e8f0fe;color:#1a73e8;padding:15px;text-align:center;font-weight:bold;font-size:1.2em;border:2px dashed #1a73e8;margin-bottom:20px;user-select:all;} button{width:100%;padding:12px;background:#28a745;color:#white;border:none;border-radius:4px;font-size:16px}</style>";
    html += "</head><body><div class='card'>";
    html += "<h2>Configurar Dispositivo</h2>";
    
    // --- EXIBE O SERIAL NUMBER PARA COPIAR ---
    html += "<p>Copie este Serial Number para seu App:</p>";
    html += "<div class='sn-box'>" + deviceID + "</div>";
    // ----------------------------------------

    html += "<form action='/save' method='POST'>";
    html += "<label>WiFi SSID:</label><input type='text' name='ssid'>";
    html += "<label>WiFi Senha:</label><input type='password' name='pass'>";
    html += "<hr><label>MQTT Host:</label><input type='text' name='mqtt_server' placeholder='ex: xxx.hivemq.cloud'>";
    html += "<label>MQTT User:</label><input type='text' name='mqtt_user'>";
    html += "<label>MQTT Pass:</label><input type='password' name='mqtt_pass'>";
    html += "<br><br><button type='submit'>SALVAR CONFIGURAÇÃO</button>";
    html += "</form></div></body></html>";
    server.send(200, "text/html", html);
  });

  server.on("/save", HTTP_POST, []() {
    if (server.arg("ssid").length() > 0) {
      preferences.putString("ssid", server.arg("ssid"));
      preferences.putString("pass", server.arg("pass"));
      preferences.putString("mqtt_server", server.arg("mqtt_server"));
      preferences.putString("mqtt_user", server.arg("mqtt_user"));
      preferences.putString("mqtt_pass", server.arg("mqtt_pass"));
      
      server.send(200, "text/html", "<h1>Salvo! O dispositivo ira reiniciar.</h1>");
      delay(2000);
      ESP.restart();
    } else {
      server.send(400, "text/html", "Erro: SSID obrigatorio");
    }
  });

  server.begin();
}

// ================================================================
// MODO OPERAÇÃO
// ================================================================
void setupModoOperacao() {
  emModoConfig = false;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid_str.c_str(), pass_str.c_str());

  Serial.print("Conectando WiFi");
  int t = 0;
  while (WiFi.status() != WL_CONNECTED && t < 40) {
    delay(250); Serial.print("."); digitalWrite(PINO_LED, !digitalRead(PINO_LED)); t++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi OK!");
    digitalWrite(PINO_LED, HIGH); // LED Aceso = Conectado
    espClient.setInsecure(); // SSL sem certificado local
    client.setServer(mqtt_server_str.c_str(), 8883);
    client.setCallback(callbackMQTT);
  } else {
    setupModoConfiguracao(); // Falhou WiFi? Volta pro AP
  }
}

void reconnectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  static unsigned long last = 0;
  if (millis() - last > 5000) {
    last = millis();
    Serial.print("Conectando MQTT...");
    // ClientID usa o Serial Number para garantir unicidade
    if (client.connect(deviceID.c_str(), mqtt_user_str.c_str(), mqtt_pass_str.c_str())) {
      Serial.println("OK!");
      client.subscribe(topic_cmd.c_str()); // Assina tópico do PRÓPRIO ID
      publicarStatus();
    } else {
      Serial.print("Falha: "); Serial.println(client.state());
    }
  }
}

void callbackMQTT(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for(int i=0; i<length; i++) msg += (char)payload[i];
  Serial.println("Comando: " + msg);

  if (msg == "ABRIR_PORTAO_AGORA") {
    // Feedback visual imediato
    String statusFeedback = (digitalRead(PINO_SENSOR) == LOW) ? "ABRINDO..." : "FECHANDO...";
    client.publish(topic_status.c_str(), statusFeedback.c_str(), true);
    acionarRele();
  }
}

void acionarRele() {
  // Lógica segura do relé
  pinMode(PINO_RELE_REAL, OUTPUT);
  digitalWrite(PINO_RELE_REAL, HIGH); delay(50);
  digitalWrite(PINO_RELE_REAL, LOW);  delay(500); // Pulso
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
  String status = (estadoSensorAnterior == HIGH) ? "ABERTO" : "FECHADO";
  // Publica no tópico específico deste Serial Number
  client.publish(topic_status.c_str(), status.c_str(), true);
}