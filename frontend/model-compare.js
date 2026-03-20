// Model configuration with available reasoning levels (lowercase values)
const modelReasoningConfig = {
    'o3': ['low', 'medium', 'high', 'xhigh'],
    'o4-mini': ['low', 'medium', 'high'],
    'gpt-5.2': ['low', 'medium', 'high'],
    'gpt-5.2-pro': ['medium', 'high', 'xhigh'],
    'gpt-5.2-codex': ['low', 'medium', 'high', 'xhigh'],
    'gpt-5.1': ['low', 'medium', 'high'],
    'gpt-5.1-codex': ['low', 'medium', 'high'],
    'gpt-5': ['medium', 'high'],
    'gpt-5-mini': ['low', 'medium'],
    'gpt-5-nano': ['low'],
    'gpt-4.1': [],
    'gpt-4.1-mini': [],
    'gpt-4.1-nano': [],
    'gpt-4o': [],
    'gpt-4o-mini': []
};

function goHome() {
    window.location.href = '/';
}

let selectedModels = [];
let schemaContent = "";
let selectedReasoning = null;
let currentSelectedModel = null;

document.addEventListener('DOMContentLoaded', function () {
    const compareForm = document.getElementById('compareForm');
    const schemaFile = document.getElementById('schemaFile');
    const modelRadios = document.querySelectorAll('input[name="modelSelection"]');
    const addModelBtn = document.getElementById('addModelBtn');
    const clearSelectionBtn = document.getElementById('clearSelectionBtn');
    const submitBtn = document.getElementById('submitBtn');

    // Handle schema file upload
    if (schemaFile) {
        schemaFile.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function (event) {
                    schemaContent = event.target.result;
                };
                reader.readAsText(file);
            }
        });
    }

    // Handle model selection from radio buttons
    modelRadios.forEach(radio => {
        radio.addEventListener('change', function () {
            const modelName = this.value;
            currentSelectedModel = modelName;
            selectedReasoning = null;

            // Get reasoning options for selected model
            const reasoningOptions = modelReasoningConfig[modelName] || [];

            // Remove any existing reasoning picker
            const existingPicker = document.querySelector('.inline-reasoning-picker');
            if (existingPicker) {
                existingPicker.remove();
            }

            if (reasoningOptions.length === 0) {
                // Prompt-only model
                addModelBtn.disabled = false;
                showReasoningPicker(modelName, this);
            } else {
                // Model supports reasoning levels
                showReasoningPicker(modelName, this);
            }
        });
    });

    // Handle add model button
    addModelBtn.addEventListener('click', function () {
        if (!currentSelectedModel) {
            alert('Please select a model');
            return;
        }

        const reasoningOptions = modelReasoningConfig[currentSelectedModel] || [];
        if (reasoningOptions.length > 0 && !selectedReasoning) {
            alert('Please select a reasoning level');
            return;
        }

        // Add the model to selected models
        addSelectedModel(currentSelectedModel, selectedReasoning || null);

        // Reset selections
        modelRadios.forEach(radio => radio.checked = false);
        currentSelectedModel = null;
        selectedReasoning = null;

        // Remove reasoning picker
        const existingPicker = document.querySelector('.inline-reasoning-picker');
        if (existingPicker) {
            existingPicker.remove();
        }

        addModelBtn.disabled = true;
    });

    // Handle clear selection button
    clearSelectionBtn.addEventListener('click', function () {
        modelRadios.forEach(radio => radio.checked = false);
        currentSelectedModel = null;
        selectedReasoning = null;

        // Remove reasoning picker
        const existingPicker = document.querySelector('.inline-reasoning-picker');
        if (existingPicker) {
            existingPicker.remove();
        }

        addModelBtn.disabled = true;
    });

    // Handle form submission
    compareForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const prompt = document.getElementById('prompt').value;
        const loading = document.getElementById('loading');
        const results = document.getElementById('results');

        if (!prompt || !prompt.trim()) {
            alert('Please enter a prompt');
            return;
        }

        if (!schemaContent) {
            alert('Please upload a schema file');
            return;
        }

        if (selectedModels.length === 0) {
            alert('Please select at least one model');
            return;
        }

        try {
            loading.style.display = 'block';
            results.style.display = 'none';

            // Call backend API to compare models — send array of pairs
            const response = await fetch('/api/compare-models', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: prompt,
                    schema: schemaContent,
                    models: selectedModels
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Display results
            displayResults(prompt, data);

        } catch (error) {
            console.error('Error:', error);
            alert('Error comparing models: ' + error.message);
        } finally {
            loading.style.display = 'none';
        }
    });
});

// Show inline reasoning picker next to a model option
function showReasoningPicker(modelName, radioEl) {
    const options = modelReasoningConfig[modelName] || [];
    const container = document.createElement('div');
    container.className = 'inline-reasoning-picker';
    container.style.marginTop = '12px';
    container.style.padding = '15px';
    container.style.border = '2px solid #667eea';
    container.style.borderRadius = '8px';
    container.style.background = '#f9f9ff';
    container.style.marginLeft = '0';
    container.style.width = '100%';

    const title = document.createElement('div');
    title.style.marginBottom = '12px';
    title.style.fontWeight = 'bold';
    title.style.color = '#333';
    title.innerHTML = `Select reasoning level for <span style="color:#667eea">${modelName}</span>:`;
    container.appendChild(title);

    if (!options || options.length === 0) {
        const p = document.createElement('div');
        p.style.color = '#666';
        p.style.marginBottom = '0';
        p.textContent = 'This is a prompt-only model (no reasoning levels available).';
        container.appendChild(p);
    } else {
        const radios = document.createElement('div');
        radios.style.marginBottom = '0';
        options.forEach(opt => {
            const label = document.createElement('label');
            label.style.marginRight = '0';
            label.style.display = 'block';
            label.style.marginBottom = '10px';
            label.style.cursor = 'pointer';
            label.style.padding = '8px';
            label.style.borderRadius = '4px';
            label.style.transition = 'background-color 0.2s';

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = `reasoning_${modelName}_${Math.random().toString(36).slice(2)}`;
            input.value = opt;
            input.style.marginRight = '8px';
            input.style.cursor = 'pointer';

            input.addEventListener('change', function () {
                selectedReasoning = opt;
                document.getElementById('addModelBtn').disabled = false;
                // Highlight selected option
                radios.querySelectorAll('label').forEach(l => l.style.backgroundColor = '');
                label.style.backgroundColor = '#e8f0ff';
            });

            label.appendChild(input);
            label.appendChild(document.createTextNode(capitalizeFirst(opt) + ' - ' + getReasoningDescription(opt)));
            radios.appendChild(label);
        });
        container.appendChild(radios);
    }

    // Find the model category and insert after the grid
    const modelGrid = radioEl.closest('.model-grid');
    if (modelGrid && modelGrid.parentElement) {
        const category = modelGrid.parentElement;
        // Insert after the grid but still within the category
        if (modelGrid.nextSibling) {
            category.insertBefore(container, modelGrid.nextSibling);
        } else {
            category.appendChild(container);
        }
    }
}
function addSelectedModel(modelName, reasoning) {
    selectedModels.push({ model: modelName, reasoning: reasoning });
    updateSelectedModelsList();
}

function updateSelectedModelsList() {
    const list = document.getElementById('selectedModelsList');
    if (!list) return;

    if (selectedModels.length === 0) {
        list.innerHTML = '<p class="empty-message">No models selected yet</p>';
        return;
    }

    let html = '';
    selectedModels.forEach((entry, idx) => {
        const reasoningText = entry.reasoning ? ` (${capitalizeFirst(entry.reasoning)})` : ' (Prompt-Only)';
        html += `
            <span class="model-chip">
                ${entry.model}${reasoningText}
                <button type="button" class="remove-btn" onclick="removeSelectedModel(${idx})" title="Remove model">×</button>
            </span>
        `;
    });
    list.innerHTML = html;
}

function removeSelectedModel(index) {
    selectedModels.splice(index, 1);
    updateSelectedModelsList();
}

// Extract category and subcategory from model response
function extractCategorySubcategory(response) {
    try {
        let data = response;

        // If response is a string, try to parse it as JSON
        if (typeof response === 'string') {
            try {
                data = JSON.parse(response);
            } catch (e) {
                // If parsing fails, check if it's in raw_response field
                return { category: null, subcategory: null };
            }
        }

        // Check if data has raw_response field
        if (data && data.raw_response) {
            try {
                data = JSON.parse(data.raw_response);
            } catch (e) {
                return { category: null, subcategory: null };
            }
        }

        // Extract category and subcategory
        const category = data && data.category ? String(data.category).toUpperCase() : null;
        const subcategory = data && data.subcategory ? parseInt(data.subcategory) : null;

        return { category, subcategory };
    } catch (error) {
        console.error('Error extracting category/subcategory:', error);
        return { category: null, subcategory: null };
    }
}

// Create impact analysis table from results
function createImpactAnalysisTable(results) {
    if (!results || !Array.isArray(results) || results.length === 0) {
        return '';
    }

    // Extract and prepare data for sorting
    const tableData = results
        .filter(result => !result.error) // Exclude error results
        .map(result => {
            const { category, subcategory } = extractCategorySubcategory(result.response);
            return {
                model: result.model,
                reasoning: result.reasoning || 'None',
                category: category || 'N/A',
                subcategory: subcategory !== null ? subcategory : 'N/A'
            };
        })
        .filter(item => item.category !== 'N/A'); // Only include items with valid category

    if (tableData.length === 0) {
        return '';
    }

    // Sort by category (A-E), then by subcategory (1-8)
    tableData.sort((a, b) => {
        // First sort by category
        if (a.category !== b.category) {
            return a.category.localeCompare(b.category);
        }
        // Then sort by subcategory
        const subA = a.subcategory === 'N/A' ? 999 : a.subcategory;
        const subB = b.subcategory === 'N/A' ? 999 : b.subcategory;
        return subA - subB;
    });

    // Generate table HTML
    let tableHTML = `
        <div class="impact-analysis-section">
            <h2>Impact Analysis</h2>
            <table class="impact-table">
                <thead>
                    <tr>
                        <th>Model Name</th>
                        <th>Reasoning</th>
                        <th>Category</th>
                        <th>Subcategory</th>
                    </tr>
                </thead>
                <tbody>
    `;

    tableData.forEach(item => {
        const categoryClass = `category-${item.category}`;
        tableHTML += `
            <tr>
                <td>${escapeHtml(item.model)}</td>
                <td>${capitalizeFirst(item.reasoning)}</td>
                <td><span class="category-badge ${categoryClass}">${item.category}</span></td>
                <td>${item.subcategory}</td>
            </tr>
        `;
    });

    tableHTML += `
                </tbody>
            </table>
        </div>
    `;

    return tableHTML;
}

function displayResults(prompt, data) {
    const results = document.getElementById('results');

    let resultsHTML = `
        <div class="results-header">
            <h2>Comparison Results</h2>
            <div class="prompt-display">
                <strong>Prompt:</strong><br>
                ${escapeHtml(prompt)}
            </div>
        </div>
        <div class="comparison-grid">
    `;

    // Display results for each model
    if (data.results && Array.isArray(data.results)) {
        data.results.forEach(result => {
            const reasoningText = result.reasoning ? ` (${result.reasoning})` : '';

            if (result.error) {
                resultsHTML += `
                    <div class="model-result">
                        <div class="model-result-header">
                            <h3>${escapeHtml(result.model)}${reasoningText}</h3>
                        </div>
                        <div class="error-message">
                            Error: ${escapeHtml(result.error)}
                        </div>
                    </div>
                `;
            } else {
                const responseText = typeof result.response === 'string'
                    ? result.response
                    : JSON.stringify(result.response, null, 2);

                resultsHTML += `
                    <div class="model-result">
                        <div class="model-result-header">
                            <h3>${escapeHtml(result.model)}${reasoningText}</h3>
                        </div>
                        <div class="model-result-content">
                            <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(responseText)}</pre>
                        </div>
                    </div>
                `;
            }
        });
    } else {
        resultsHTML += `
            <div class="model-result">
                <div class="error-message">
                    Unexpected response format
                </div>
            </div>
        `;
    }

    resultsHTML += `
        </div>
    `;

    // Add impact analysis table
    if (data.results && Array.isArray(data.results)) {
        const impactTableHTML = createImpactAnalysisTable(data.results);
        resultsHTML += impactTableHTML;
    }

    results.innerHTML = resultsHTML;
    results.style.display = 'block';

    // Scroll to results
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function getReasoningDescription(level) {
    const descriptions = {
        'low': 'Basic processing',
        'medium': 'Balanced approach',
        'high': 'Deep analysis',
        'xhigh': 'Maximum depth'
    };
    return descriptions[level] || '';
}
