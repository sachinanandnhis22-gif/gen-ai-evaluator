# Prompt Transformer - AI Prompt Management & Comparison Tool

A full-stack web application for managing, transforming, and comparing AI prompts using OpenAI's latest models. Built with FastAPI (backend) and vanilla JavaScript (frontend).

## 🧠 Detailed Logic Documentation

For a full internal walkthrough of how the project works end-to-end (frontend flow, backend pipeline, prompt transformation logic, model routing, impact metrics, and persistence), see:

- [PROJECT_LOGIC.md](PROJECT_LOGIC.md)

## 📋 Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [Supported Models](#supported-models)
- [File Format](#file-format)
- [Pricing & Cost Tracking](#pricing--cost-tracking)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## ✨ Features

- **Multi-Model Support**: Run prompts against different OpenAI models (GPT-5.x, GPT-4.x, O-series)
- **Reasoning Effort Configuration**: Configure different reasoning levels (low, medium, high, xhigh) for supported models
- **Batch Processing**: Upload and process multiple prompts from files
- **Model Comparison**: Compare responses from multiple models side-by-side
- **Cost Tracking**: Automatic calculation of API costs based on token usage
- **Prompt Transformation**: Transform old prompts to new ones with AI assistance
- **Response Formatting**: Format responses (JSON, string, pretty print)
- **Persistent Configuration**: Save and load model configurations
- **Responsive UI**: Modern, mobile-friendly web interface

## 📁 Project Structure

```
project1/
├── backend/
│   ├── main.py                 # FastAPI application with all endpoints
│   ├── requirements.txt         # Python dependencies
│   ├── model_config.json        # Persistent model configuration (auto-generated)
│   ├── schema.json              # Response schema definition
│   ├── outputs/                 # Generated output files
│   │   └── latest_run.json      # Latest processing results
│   └── __pycache__/             # Python cache
├── frontend/
│   ├── index.html               # Main prompt transformer page
│   ├── home.html                # Home/navigation page
│   ├── model-compare.html       # Model comparison interface
│   ├── script.js                # Main application logic
│   ├── model-compare.js         # Model comparison functionality
│   ├── model-config.js          # Model configuration management
│   ├── styles.css               # Global styles
│   ├── model-config.css         # Modal and config styles
│   └── svg files (if any)       # Icons/graphics
└── README.md                    # This file
```

## 🔧 Prerequisites

- **Python 3.8+**
- **Node.js** (for frontend development, optional)
- **OpenAI API Key** (required for functionality)
- **pip** (Python package manager)

## 📥 Installation & Setup

### 1. Clone/Download the Project

```bash
cd project1
```

### 2. Set Up Backend Environment

#### Create Virtual Environment
```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

#### Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Environment

Create a `.env` file in the `backend/` directory:

```env
OPENAI_API_KEY=your-api-key-here
OPENAI_MODEL=gpt-4o-mini
TIMEOUT=30
```

**Environment Variables**:
- `OPENAI_API_KEY`: Your OpenAI API key (from https://platform.openai.com/api-keys)
- `OPENAI_MODEL`: Default model to use (default: `gpt-4o-mini`)
- `TIMEOUT`: Request timeout in seconds (default: `30`, heavy reasoning models use 300s)

### 4. Run the Application

```bash
cd backend
python main.py
```

Or with uvicorn:
```bash
uvicorn main:app --reload --port 8000
```

The application will start at: **http://localhost:8000**

## ⚙️ Configuration

### Model Configuration

Model configuration is managed through the web UI:

1. Navigate to **http://localhost:8000** (Home page)
2. Click **"Add Model"** on any page
3. Select an AI model from the list
4. If supported, select a reasoning level
5. Click **"Add Model"** to confirm
6. Click **"Save Configuration"** to persist

Configuration is saved to `backend/model_config.json`.

### Supported Reasoning Levels

Not all models support reasoning effort. See [Supported Models](#supported-models) for details.

- **low**: Fast, cost-effective reasoning
- **medium**: Balanced reasoning
- **high**: Deep reasoning with more computation
- **xhigh**: Extreme reasoning (highest cost, longest latency)

## 📖 Usage

### 1. Home Page (`/`)
Main hub with options to:
- **Prompt Transformer**: Transform and run prompts on files
- **Model Compare**: Compare outputs from multiple models

### 2. Prompt Transformer (`/index.html`)

**Steps**:
1. Upload a CSV/Excel file with prompt data
2. Select a CSV column containing prompts
3. Optionally select columns for responses to transform
4. Choose output format
5. Click **"Transform"** to process

**Supported Formats**:
- CSV files (.csv)
- Excel files (.xlsx)
- JSON files (.json)

### 3. Model Comparison (`/model-compare.html`)

**Steps**:
1. Select 2+ models to compare
2. Upload schema file (optional, defines response structure)
3. Enter sample data or prompt
4. Click **"Compare Models"**
5. View side-by-side responses and cost comparisons

### 4. Model Configuration (`/model-config.js`)

- View all configured models
- Add new models with reasoning levels
- Remove models
- Save configuration

## 🔌 API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/run` | Run prompt transformation on uploaded file |
| GET | `/api/last_run` | Get the last run's output |
| GET | `/row_data/{index}` | Get data from a specific row |
| POST | `/api/format_content` | Format content (JSON, string, pretty) |
| GET | `/api/get-model-config` | Get current model configuration |
| POST | `/run_custom_prompt` | Run a custom prompt |
| GET | `/api/get-all-models` | Get all available models |
| GET | `/api/compare-models` | Compare multiple models |
| GET | `/outputs/{filename}` | Retrieve output file |

### Request/Response Schema

**Response Schema** (`schema.json`):

Models return structured responses with:
- `score_explanation`: Detailed markdown-formatted explanation
- `category`: Classification (A/B/C/D)
- `subcategory`: Numeric classification (1-8)
- `summary`: 10-15 word summary

## 📊 Supported Models

### GPT-5 Series
| Model | Reasoning Support | Levels |
|-------|-------------------|--------|
| gpt-5.2 | ✅ Yes | low, medium, high |
| gpt-5.2-pro | ✅ Yes | medium, high, xhigh |
| gpt-5.2-codex | ✅ Yes | low, medium, high, xhigh |
| gpt-5.1 | ✅ Yes | low, medium, high |
| gpt-5.1-codex | ✅ Yes | low, medium, high |
| gpt-5 | ✅ Yes | medium, high |
| gpt-5-mini | ✅ Yes | low, medium |
| gpt-5-nano | ✅ Yes | low |

### GPT-4 Series
| Model | Reasoning Support |
|-------|-------------------|
| gpt-4.1 | ❌ No |
| gpt-4.1-mini | ❌ No |
| gpt-4.1-nano | ❌ No |
| gpt-4o | ❌ No |
| gpt-4o-mini | ❌ No |

### O Series
| Model | Reasoning Levels |
|-------|------------------|
| o3 | low, medium, high, xhigh |
| o4-mini | low, medium, high |

## 💰 Pricing & Cost Tracking

Costs are automatically calculated based on:
- **Input tokens**: Prompt token count (with cached token discount)
- **Output tokens**: Generated response token count
- **Reasoning tokens**: Additional tokens used for reasoning (O and GPT-5 series)
- **Cached tokens**: Previously cached tokens (10% of input price)

**Price Table** (per 1M tokens, USD):

| Model | Input | Output | Cached |
|-------|-------|--------|--------|
| gpt-5.2 | $1.75 | $14.00 | $0.175 |
| gpt-4o-mini | $0.15 | $0.60 | $0.075 |
| o3 | $2.00 | $8.00 | $0.50 |

See `main.py` for complete pricing table.

## 📄 File Format

### Input CSV/Excel

| Column | Type | Description |
|--------|------|-------------|
| Any column | text | Contains prompts to transform |
| Any column | text | Contains existing responses (optional) |

Example:
```csv
prompt,response
"What is AI?","AI stands for Artificial Intelligence..."
"How does ML work?","Machine Learning is a subset of AI..."
```

### Output JSON

```json
{
  "success": true,
  "total_rows": 2,
  "processed_rows": 2,
  "results": [
    {
      "original": "What is AI?",
      "transformed": "...",
      "cost": 0.00123,
      "tokens": {"input": 45, "output": 120}
    }
  ]
}
```

## 🐛 Troubleshooting

### "API Key not found"
- Ensure `.env` file exists in `backend/` directory
- Verify `OPENAI_API_KEY` is correctly set
- Check the key is valid at https://platform.openai.com/api-keys

### "Model not found"
- Ensure model name matches exactly (check spelling)
- Verify model is available in your OpenAI account
- Check model hasn't been deprecated

### "Timeout Error"
- Increase `TIMEOUT` in `.env` (reasoning models need more time)
- Default timeout: 30s, reasoning models use 300s (5 min)
- Check OpenAI API status

### File Upload Issues
- Ensure file is CSV, Excel, or JSON format
- Check file size (large files may timeout)
- Verify file has expected columns
- Try downloading sample file from UI

### Configuration Not Saving
- Check write permissions on `backend/model_config.json`
- Clear browser cache and reload
- Restart the application

## 📝 Requirements

See `backend/requirements.txt`:

```
fastapi==0.104.1
uvicorn==0.24.0
python-dotenv==1.0.0
httpx==0.25.0
pandas>=2.2.0
openpyxl==3.1.0
```

## 🚀 Deployment

### Development
```bash
cd backend
python main.py
```

### Production

Use a production ASGI server:
```bash
gunicorn main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker
```

Or with uvicorn:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

## 📞 Support & Development

For issues or feature requests:
1. Check the **Troubleshooting** section
2. Review console logs (browser DevTools or terminal)
3. Verify API configuration and credentials
4. Check OpenAI API documentation: https://platform.openai.com/docs

## 📜 License

This project is provided as-is for personal and commercial use.

---

**Last Updated**: March 9, 2026

**Version**: 1.0

**Author**: Your Name/Organization
