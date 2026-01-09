# 🔥 Ceniza-Bot v4.5

> [!IMPORTANT]  
> Un bot de Discord avanzado con **IA de Meta**, integración profunda con **Terraria** y capacidades de **Visión Artificial**.

---

## ✨ Características Principales

| Categoría | Funcionalidades |
| :--- | :--- |
| **🧠 Inteligencia Artificial** | Conversación natural con memoria, análisis de intención y router de modelos (Groq). |
| **🌲 Terraria** | Consulta de items (`items.json`), asistente de Wiki y chequeo de estado del servidor. |
| **👁️ Vision & Audio** | Transcripción de videos de YouTube, descripción de imágenes y OCR. |
| **🎨 Arte** | Generación de imágenes con Fluxeniza, Zeniza, Ceniturbo y Nanoceniza Pro. |
| **🛡️ Moderación** | Sistema de sanciones con confirmación (`ban`, `kick`, `timeout`) y gestión de roles. |

---

## 🚀 Guía de Instalación

### Requisitos
- **Node.js** v18+
- **Python** 3.10+ (con `pip`)

### Pasos
1.  **Clonar y preparar:**
    ```bash
    npm install
    cd python && pip install -r requirements.txt
    ```

2.  **Variables de Entorno (.env):**
    > [!TIP]
    > Asegúrate de tener tus API keys de Groq listas.
    ```env
    DISCORD_TOKEN=...
    GROQ_API_KEY=...
    GROQ_ROUTER_API_KEY=...
    ```

3.  **Configuración del Servidor:**
    Edita `serverConfig.json` para definir la IP de tu servidor de Terraria, bosses, y el "lore" del bot.

4.  **Iniciar:**
    ```bash
    npm start
    ```

---

## 📚 Comandos Disponibles

<details>
<summary><strong>👇 Clic para ver la lista completa</strong></summary>

### 🎨 Creatividad
- `/dibujar prompt:[texto] modelo:[fluxeniza/etc]` - Genera arte.
- `/image describe` - Describe lo que ve en una imagen.
- `/image ask` - Responde preguntas sobre una imagen.
- `/image text` - Extrae texto de una imagen.

### 🌲 Terraria
- `/item info name:[item]` - Datos técnicos (daño, crafteo).
- `/item ask question:[duda]` - Preguntas libres sobre items.
- `/wiki summarize url:[link]` - Resume una página de la wiki.
- `/wiki ask` - Preguntas sobre una página específica.
- `/serverstatus` - Ping TCP al servidor configurado.

### 🎥 Multimedia
- `/video prompt:[duda] link:[url]` - Analiza videos de YouTube o archivos de audio.

### 🛡️ Administración
- `/ban`, `/kick`, `/timeout` - Sanciones con botón de confirmación.
- `/role add/remove` - Gestión rápida de roles.
- `/nickname` - Cambiar apodos.
- `/channel info` - Análisis de canales públicos.
- `/channels list` - Lista canales visibles.
- `/config` - Ver o editar configuración en caliente.
</details>

---

## 🤝 Créditos

> [!NOTE]
> Creado por **@isawicca**. Contáctame en [Discord](https://discord.gg/bJQ7UbTf).
> Si tienes dudas, pregúntale a **ChatGPT**.
> Gracias por usar Ceniza-Bot.
