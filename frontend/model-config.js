// Model configuration with available reasoning levels (lowercase values)
// Replicating logic from model-compare.js
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

let selectedModels = [];
let currentSelectedModel = null;
let selectedReasoning = null;

// Initialize when script loads (or can be called explicitly)
function initModelConfig() {
    const modelRadios = document.querySelectorAll('.model-radio');
    const addModelBtn = document.getElementById('addModelBtn');
    const clearSelectionBtn = document.getElementById('clearSelectionBtn');
    const saveBtn = document.getElementById('saveBtn');

    // Load saved configuration first
    loadSavedConfiguration();

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

            // Also hide old-style container if it exists (cleanup)
            document.querySelectorAll('.category-reasoning-container').forEach(el => el.style.display = 'none');


            if (reasoningOptions.length === 0) {
                // Prompt-only model
                addModelBtn.disabled = false;
                showReasoningPicker(modelName, this);
            } else {
                // Model supports reasoning levels
                addModelBtn.disabled = true; // Disable until reasoning is picked
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

        // Scroll to top to see selection
        document.getElementById('selectedModelsSection').scrollIntoView({ behavior: 'smooth' });
    });

    // Handle clear selection button
    if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', function () {
            modelRadios.forEach(radio => radio.checked = false);
            currentSelectedModel = null;
            selectedReasoning = null;

            // Remove reasoning picker
            const existingPicker = document.querySelector('.inline-reasoning-picker');
            if (existingPicker) {
                existingPicker.remove();
            }

            // Hide old containers too
            document.querySelectorAll('.category-reasoning-container').forEach(el => el.style.display = 'none');

            addModelBtn.disabled = true;
        });
    }

    // Handle Save button
    if (saveBtn) {
        saveBtn.addEventListener('click', saveConfiguration);
    }

}

// Call init immediately since script is loaded at end of body
initModelConfig();

// Show inline reasoning picker next to a model option
// Logic copied directly from model-compare.js
function showReasoningPicker(modelName, radioEl) {
    const options = modelReasoningConfig[modelName] || [];
    const container = document.createElement('div');
    container.className = 'inline-reasoning-picker';
    // Use the same styles as model-compare.js but maybe ensure they are applied if CSS doesn't cover it
    // model-compare.js applies them inline, so we do too.
    container.style.marginTop = '12px';
    container.style.padding = '15px';
    container.style.border = '2px solid #667eea';
    container.style.borderRadius = '8px';
    container.style.background = '#f8faff'; // Matching the light blue requested in image
    container.style.marginLeft = '0';
    container.style.width = '100%';
    container.style.boxSizing = 'border-box';

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
            label.style.display = 'flex';
            label.style.alignItems = 'center';

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = `reasoning_${modelName}_${Math.random().toString(36).slice(2)}`;
            input.value = opt;
            input.style.marginRight = '10px';
            input.style.cursor = 'pointer';
            input.style.accentColor = '#667eea';

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
    // Check for duplicates
    const exists = selectedModels.some(m => m.model === modelName && m.reasoning === reasoning);
    if (exists) {
        alert('This model configuration is already selected.');
        return;
    }

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
        // Using the styling structure from previous task but generation logic from model-compare
        html += `
            <div class="model-chip">
                <span>${entry.model}${reasoningText}</span>
                <button type="button" class="remove-btn" onclick="removeSelectedModel(${idx})" title="Remove model">×</button>
            </div>
        `;
    });
    list.innerHTML = html;
}

function removeSelectedModel(index) {
    selectedModels.splice(index, 1);
    updateSelectedModelsList();
}

// Config saving logic (kept from original model-config.js as it's specific to this page)
function saveConfiguration() {
    if (selectedModels.length === 0) {
        alert('Please select at least one model before saving.');
        return;
    }

    const config = {
        models: selectedModels,
        timestamp: new Date().toISOString()
    };

    fetch('/api/save-model-config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const btn = document.getElementById('saveBtn');
                if (btn) {
                    const originalText = btn.textContent;
                    btn.textContent = '✓ Saved!';
                    btn.style.background = '#4CAF50';
                    setTimeout(() => {
                        // Reset button
                        btn.textContent = originalText;
                        btn.style.background = '';
                        // Close modal
                        closeModelConfig();
                    }, 500);
                }
            }
        })
        .catch(error => {
            console.error('Error saving configuration:', error);
            alert('Error saving configuration to server');
        });
}

function loadSavedConfiguration() {
    fetch('/api/get-model-config')
        .then(res => res.json())
        .then(data => {
            if (data.config && data.config.models) {
                selectedModels = data.config.models;
                updateSelectedModelsList();
            } else if (data.config && data.config.model) {
                // Handle legacy single-model format
                selectedModels = [{
                    model: data.config.model,
                    reasoning: data.config.reasoning
                }];
                updateSelectedModelsList();
            }
        })
        .catch(err => console.error("Failed to load config", err));
}


function capitalizeFirst(str) {
    if (!str) return '';
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

function goBack() {
    closeModelConfig();
}