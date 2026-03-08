# AI Code Generator & Debugger (MCP Server)

An AI-powered **Model Context Protocol (MCP) server** that provides intelligent **code generation and debugging tools** using **Google Gemini**.
This server integrates with AI development environments such as **Cursor** and exposes tools that can automatically generate code or debug faulty programs.

---

## 🚀 Features

* 🔧 **Code Generation**

  * Generate clean and well-commented code for programming tasks.

* 🐞 **Code Debugging**

  * Analyze buggy code.
  * Identify the problem.
  * Provide a corrected version with explanation.

* 🤖 **AI Powered**

  * Uses **Google Gemini models** for intelligent code assistance.

* 🔌 **MCP Compatible**

  * Works with MCP-compatible tools like **Cursor IDE**.

---

## 🧠 Available Tools

### 1. `generate_code`

Generates code for a given programming task.

**Input**

```
{
  "prompt": "Write a Python binary search function"
}
```

**Example Output**

```python
def binary_search(arr, target):
    left = 0
    right = len(arr) - 1

    while left <= right:
        mid = (left + right) // 2

        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1

    return -1
```

---

### 2. `debug_code`

Analyzes faulty code and provides a corrected version.

**Input**

```
{
  "code": "def add(a,b)\nreturn a+b",
  "errorMessage": "SyntaxError expected ':'"
}
```

**Example Output**

```python
def add(a, b):
    return a + b
```

---

## 🏗 Project Structure

```
mcp-code-assistant
│
├── mcp-server.js
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

---

## ⚙️ Installation

Clone the repository:

```
git clone https://github.com/yourusername/mcp-code-assistant.git
cd mcp-code-assistant
```

Install dependencies:

```
npm install
```

---

## 🔑 Environment Setup

Create a `.env` file in the root directory.

```
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

---

## ▶️ Run the MCP Server

Start the MCP server:

```
node mcp-server.js
```

The server will run and wait for MCP clients such as **Cursor** to connect.

---

## 🔗 Cursor MCP Configuration

Add the following configuration to your Cursor MCP settings:

```
{
  "mcpServers": {
    "code-assistant": {
      "command": "node",
      "args": [
        "C:\\path\\to\\mcp-server.js"
      ]
    }
  }
}
```

Restart Cursor after saving the configuration.

---

## 🧩 Architecture

```
Cursor IDE
     ↓
MCP Protocol
     ↓
MCP Server (Node.js)
     ↓
Google Gemini API
     ↓
Generated / Debugged Code
```

---

## 🛠 Tech Stack

* **Node.js**
* **Model Context Protocol (MCP)**
* **Google Gemini API**
* **Cursor IDE**

---

## 📌 Future Improvements

* Code explanation tool
* Code optimization tool
* Language conversion (Python ⇄ Java ⇄ C++)
* Unit test generation

---

## 📄 License

This project is open-source and available under the **MIT License**.

---

## 👨‍💻 Author

Developed by **Nikhil Reddy**
Computer Science Engineering Student
