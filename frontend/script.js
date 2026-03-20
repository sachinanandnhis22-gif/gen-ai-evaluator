// ============================================================
// CONSTANTS & CONFIGURATION
// ============================================================

const FIELD_MAP = {
  oldPromptContent: 'prompt',
  newPromptContent: 'new_prompt',
  oldResponseContent: 'response',
  newResponseContent: 'new_response',
};

const API = {
  RUN: '/run',
  LAST_RUN: '/api/last_run',
  ROW_DATA: (idx) => `/row_data/${idx}`,
  MODEL_CONFIG: '/api/get-model-config',
  FORMAT_CONTENT: '/api/format_content',
  SAVE_FORMATTING: '/api/save_formatting',
  RUN_CUSTOM_PROMPT: '/run_custom_prompt',
  OUTPUTS: (filename) => `/outputs/${filename}`,
};

// ============================================================
// UTILITIES
// ============================================================

const $ = (id) => document.getElementById(id);
const $q = (selector) => document.querySelector(selector);

/**
 * Generic fetch wrapper with JSON error handling.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Detect the first XML-like tag pattern in a string.
 * @param {string} text
 * @returns {string|null} Tag name or null
 */
function detectTag(text) {
  const match = text.match(/<([A-Z_][A-Z0-9_]*)>(.*?)<\/\1>/s);
  return match ? match[1] : null;
}

/**
 * Format text locally without a backend call.
 * @param {string} text
 * @param {'string'|'json'|'pretty'} formatType
 * @returns {string}
 */
function formatTextLocally(text, formatType) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  switch (formatType) {
    case 'string':
      return lines.join(' ');
    case 'json':
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text.trim();
      }
    case 'pretty':
      return lines.join('\n');
    default:
      return text;
  }
}

function formatDurationSeconds(value) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0.00 s';
  }

  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

// ============================================================
// SESSION STORAGE
// ============================================================

function saveFormDataToSession() {
  const textareas = $('staticInputs').querySelectorAll('textarea');
  const staticInputs = {};
  textareas.forEach((ta) => { staticInputs[ta.name] = ta.value; });

  const formData = {
    rowOption: $('rowOption').value,
    numStatics: $('numStatics').value,
    numRows: $('numRows').value,
    startRow: $('startRow').value,
    endRow: $('endRow').value,
    staticInputs,
  };

  sessionStorage.setItem('formData', JSON.stringify(formData));
}

function restoreFormDataFromSession() {
  const saved = sessionStorage.getItem('formData');
  if (!saved) return false;

  try {
    const data = JSON.parse(saved);
    const rowOption = $('rowOption');

    rowOption.value = data.rowOption;
    $('numRowsGroup').style.display = data.rowOption === 'number' ? 'block' : 'none';
    $('rangeGroup').style.display = data.rowOption === 'range' ? 'block' : 'none';

    $('numStatics').value = data.numStatics;
    generateStaticInputs(parseInt(data.numStatics, 10));

    // Defer restoration until DOM reflects generated inputs
    setTimeout(() => {
      $('numRows').value = data.numRows;
      $('startRow').value = data.startRow;
      $('endRow').value = data.endRow;

      Object.entries(data.staticInputs).forEach(([name, value]) => {
        const ta = $q(`textarea[name="${name}"]`);
        if (ta) ta.value = value;
      });
    }, 100);

    return true;
  } catch (e) {
    console.error('Error restoring form data:', e);
    return false;
  }
}

// ============================================================
// NAVIGATION & MODAL
// ============================================================

function goHome() {
  window.location.href = '/';
}

function goToModelConfig() {
  $('modelConfigModal').style.display = 'block';
  if (typeof loadSavedConfiguration === 'function') {
    loadSavedConfiguration();
  }
}

function closeModelConfig() {
  $('modelConfigModal').style.display = 'none';
  loadCurrentModelConfig();
}

// ============================================================
// STATIC INPUT GENERATION
// ============================================================

function generateStaticInputs(num) {
  const container = $('staticInputs');
  container.innerHTML = '';

  for (let i = 1; i <= num; i++) {
    const section = document.createElement('div');
    section.className = 'static-section';
    section.innerHTML = `
      <div class="static-column">
        <h3>Initial Groups - Static ${i}</h3>
        <textarea name="initial_static${i}" placeholder="Enter initial static ${i} content..." required></textarea>
      </div>
      <div class="static-column">
        <h3>New Groups - Static ${i}</h3>
        <textarea name="new_static${i}" placeholder="Enter new static ${i} content..." required></textarea>
      </div>
    `;
    container.appendChild(section);
  }
}

// ============================================================
// MODEL CONFIG DISPLAY
// ============================================================

function loadCurrentModelConfig() {
  fetch(API.MODEL_CONFIG)
    .then((r) => r.json())
    .then(({ config }) => {
      const btn = $('currentModelBtn');

      if (config?.models?.length > 0) {
        const titles = config.models.map((m) =>
          m.reasoning ? `${m.model} (${m.reasoning})` : m.model
        );
        const label = titles.join(', ');
        btn.textContent = label;
        btn.title = label;
      } else if (config?.model) {
        const label = config.reasoning
          ? `${config.model} (${config.reasoning})`
          : config.model;
        btn.textContent = label;
        btn.title = label;
      } else {
        btn.textContent = 'No model selected';
        btn.title = 'No model selected';
      }
    })
    .catch(() => {
      const btn = $('currentModelBtn');
      btn.textContent = 'Error loading model';
      btn.title = 'Error loading model configuration';
    });
}

// ============================================================
// OUTPUT DOWNLOAD
// ============================================================

function downloadOutput(filePath) {
  const filename = filePath.split('/').pop();
  window.open(API.OUTPUTS(filename));
}

// ============================================================
// MAIN DOMContentLoaded
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // ── Element refs ──────────────────────────────────────────
  const rowOption   = $('rowOption');
  const numStatics  = $('numStatics');
  const staticInputs = $('staticInputs');
  const uploadForm  = $('uploadForm');
  const submitBtn   = $('submitBtn');
  const loading     = $('loading');
  const results     = $('results');

  let currentRowData = null;
  let attachSelectionListeners = null; // Set after displayResults builds the DOM
  let allRowIndices = [];
  let activeImpactFilter = null;
  let activeImpactModelIndex = null;

  const IMPACT_FILTER_LABELS = {
    category_changes: 'Category Change',
    upgrades: 'Upgrade',
    downgrades: 'Downgrade',
    subcategory_changes: 'Subcategory Change',
  };

  // ── Init ──────────────────────────────────────────────────
  loadCurrentModelConfig();

  if (!restoreFormDataFromSession()) {
    generateStaticInputs(1);
  }

  // ── Auto-save listeners ───────────────────────────────────
  [rowOption, numStatics].forEach((el) =>
    el.addEventListener('change', saveFormDataToSession)
  );
  staticInputs.addEventListener('input', saveFormDataToSession);
  ['numRows', 'startRow', 'endRow'].forEach((id) =>
    $(id).addEventListener('input', saveFormDataToSession)
  );

  // ── Row option visibility ─────────────────────────────────
  rowOption.addEventListener('change', function () {
    $('numRowsGroup').style.display = this.value === 'number' ? 'block' : 'none';
    $('rangeGroup').style.display   = this.value === 'range'  ? 'block' : 'none';
  });

  // ── Statics count change ──────────────────────────────────
  numStatics.addEventListener('change', function () {
    generateStaticInputs(parseInt(this.value, 10));
  });

  // ────────────────────────────────────────────────────────────
  // FORM SUBMISSION
  // ────────────────────────────────────────────────────────────
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    loading.style.display = 'block';
    results.style.display = 'none';

    try {
      const excelFile  = $('excelFile').files[0];
      const schemaFile = $('schemaFile').files[0];

      if (!excelFile || !schemaFile) {
        throw new Error('Please select both Excel and Schema files.');
      }

      const formData = new FormData();
      const processedExcel = await processExcelFile(excelFile);
      formData.append('input_excel', processedExcel, excelFile.name);

      const structure = createStructureJSON();
      const structureBlob = new Blob(
        [JSON.stringify(structure, null, 2)],
        { type: 'application/json' }
      );
      formData.append('structure_json_file', structureBlob, 'structure.json');
      formData.append('schema_file', schemaFile, schemaFile.name);
      formData.append('output_filename', 'output_results.xlsx');

      const result = await apiFetch(API.RUN, { method: 'POST', body: formData });
      displayResults(result, structure);
    } catch (error) {
      displayError(error.message);
    } finally {
      submitBtn.disabled = false;
      loading.style.display = 'none';
    }
  });

  // ────────────────────────────────────────────────────────────
  // EXCEL PROCESSING
  // ────────────────────────────────────────────────────────────
  async function processExcelFile(file) {
    const buffer    = await file.arrayBuffer();
    const workbook  = XLSX.read(buffer);
    const sheetName = workbook.SheetNames[0];
    let data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    // Remove empty rows
    data = data.filter((row) =>
      row.some((cell) => cell !== null && cell !== undefined && cell !== '')
    );

    const option = $('rowOption').value;
    if (option === 'number') {
      const numRows = parseInt($('numRows').value, 10);
      if (numRows && numRows < data.length) {
        data = data.slice(0, numRows + 1); // +1 for header at index 0
      }
    } else if (option === 'range') {
      // Row numbers are 1-based (row 1 = first data row after header).
      // data[0] is always the header row — we preserve it explicitly so the
      // backend can map column names regardless of which range is selected.
      const start = Math.max(1, parseInt($('startRow').value, 10) || 1);
      const end   = parseInt($('endRow').value, 10) || data.length - 1;
      const dataRows = data.slice(start, end + 1); // inclusive on both ends
      data = [data[0], ...dataRows];               // header + selected rows
    }

    const newWorkbook  = XLSX.utils.book_new();
    const newWorksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);

    const wbout = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'array' });
    return new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  // ────────────────────────────────────────────────────────────
  // STRUCTURE JSON
  // ────────────────────────────────────────────────────────────
  function createStructureJSON() {
    const num = parseInt(numStatics.value, 10);
    const initialGroups = {};
    const newGroups     = {};
    const outputSequence = ['dynamic1'];

    for (let i = 1; i <= num; i++) {
      initialGroups[`static${i}`] = $q(`[name="initial_static${i}"]`).value;
      newGroups[`static${i}`]     = $q(`[name="new_static${i}"]`).value;
      outputSequence.push(`newstatic${i}`, `dynamic${i + 1}`);
    }

    return { initial_groups: initialGroups, new_groups: newGroups, output_sequence: outputSequence };
  }

  // ────────────────────────────────────────────────────────────
  // LOAD LAST RUN (unused in main flow but preserved)
  // ────────────────────────────────────────────────────────────
  async function loadLastRunResults() {
    try {
      const data = await apiFetch(API.LAST_RUN);
      if (data.status === 'completed') {
        $('results').style.display = 'block';
        displayResults(data, {});
      }
    } catch (e) {
      console.log('Failed to load last run:', e);
    }
  }

  // ────────────────────────────────────────────────────────────
  // DISPLAY HELPERS
  // ────────────────────────────────────────────────────────────
  function displayError(message) {
    results.innerHTML = `<div class="error">${message}</div>`;
    results.style.display = 'block';
  }

  // ────────────────────────────────────────────────────────────
  // RESULTS RENDERING
  // ────────────────────────────────────────────────────────────
  function displayResults(result, structure) {
    results.innerHTML = '';

    results.appendChild(createSuccessBanner(result));
    results.appendChild(createSchemaSection(result));

    if (result.impact_metrics?.length > 0) {
      results.appendChild(createImpactSection(result));
    }

    results.appendChild(createDownloadSection(result));
    results.appendChild(createRowViewerSection(result));

    appendContextMenu();
    appendPreviewPanel();
    initPreviewPanelHandlers();

    initRowSelector(result);
    initImpactModelFilter();
    initImpactMetricFilters(result);
    initShowResponsesBtn();
    initEditPromptFlow(result.new_schema);

    results.style.display = 'block';

    // Attach text-selection listeners (defined after DOM is ready)
    attachSelectionListeners = buildSelectionListeners();
    attachSelectionListeners();
  }

  // ── Banner ────────────────────────────────────────────────
  function createSuccessBanner(result) {
    const div = document.createElement('div');
    div.className = 'success';
    div.textContent = `Processing completed! ${result.successful_rows} successful, ${result.failed_rows} failed.`;
    return div;
  }

  // ── Schema comparison ─────────────────────────────────────
  function createSchemaSection(result) {
    const section = document.createElement('div');
    section.className = 'result-section';
    section.innerHTML = `
      <h2>Schema Comparison</h2>
      <div class="prompt-comparison">
        <div class="prompt-column">
          <h3>Old Schema</h3>
          <div class="schema-display">${result.old_schema}</div>
        </div>
        <div class="prompt-column">
          <h3>New Schema</h3>
          <div class="schema-display">${result.new_schema}</div>
        </div>
      </div>
    `;
    return section;
  }

  // ── Impact metrics ────────────────────────────────────────
  function createImpactSection(result) {
    const section = document.createElement('div');
    section.className = 'result-section';
    section.innerHTML = '<h2>Impact Analysis</h2>';

    if ((result.impact_metrics || []).length > 1) {
      section.innerHTML += `
        <div class="impact-model-filter form-group">
          <label for="impactModelSelector">Select Model:</label>
          <select id="impactModelSelector">
            ${result.impact_metrics.map((metrics) => `
              <option value="${metrics.model_index}">${metrics.model_used || `Model ${metrics.model_index}`}</option>
            `).join('')}
          </select>
        </div>
      `;
    }

    result.impact_metrics.forEach((metrics) => {
      section.innerHTML += buildMetricsHTML(metrics);
    });

    if (result.impact_metrics.some((m) => m.total_cost !== undefined)) {
      section.innerHTML += buildCostComparisonTable(result.impact_metrics);
    }

    return section;
  }

  function buildMetricsHTML(m) {
    const costHTML = m.total_cost !== undefined ? `
      <div class="metric-card" style="border-color:#4CAF50;">
        <h3 style="color:#2E7D32;">Estimated Cost</h3>
        <div class="metric-value" style="color:#2E7D32;">$${m.total_cost.toFixed(4)}</div>
        <div class="metric-desc">Avg: $${m.avg_cost_per_row.toFixed(4)} / row</div>
        <div class="token-breakdown" style="font-size:0.8em;color:#666;margin-top:5px;text-align:left;">
          <div>Input: ${m.total_input_tokens.toLocaleString()}</div>
          <div>Output: ${m.total_output_tokens.toLocaleString()}</div>
          <div>Reasoning: ${(m.total_reasoning_tokens || 0).toLocaleString()}</div>
          <div>Cached: ${m.total_cached_tokens.toLocaleString()}</div>
        </div>
      </div>` : '';

    const timeHTML = `
      <div class="metric-card" style="border-color:#2196F3;">
        <h3 style="color:#1565C0;">Avg Response Time</h3>
        <div class="metric-value" style="color:#1565C0;">${formatDurationSeconds(m.avg_response_time_seconds || 0)}</div>
        <div class="metric-desc">Total: ${formatDurationSeconds(m.total_response_time_seconds || 0)} across ${m.timed_rows_count || 0} prompt(s)</div>
      </div>`;

    const bias = m.net_decision_bias;
    const biasClass = bias > 0 ? 'positive' : bias < 0 ? 'negative' : '';
    const biasPrefix = bias > 0 ? '+' : '';

    const subLabels = Array.from(new Set([
      ...Object.keys(m.subcategory_confusion_matrix || {}),
      ...Object.values(m.subcategory_confusion_matrix || {}).flatMap(Object.keys),
    ])).sort((a, b) => parseInt(a) - parseInt(b));

    return `
      <div class="impact-metrics" data-impact-model-index="${m.model_index}" style="border:1px solid #eee;padding:20px;border-radius:8px;margin-bottom:20px;">
        <h3 style="margin-top:0;color:#667eea;border-bottom:1px solid #eee;padding-bottom:10px;">
          Model: ${m.model_used || 'Unknown'}
        </h3>
        <div class="metrics-grid">
          ${costHTML}
          ${timeHTML}
          <div class="metric-card impact-filter-card" data-model-index="${m.model_index}" data-impact-filter="category_changes" style="cursor:pointer;">
            <h3>Category Change Rate</h3>
            <div class="metric-value">${m.category_change_rate}%</div>
            <div class="metric-count">(${m.raw_counts.category_changes} out of ${m.total_candidates})</div>
            <div class="metric-desc">Percentage of responses that changed categories</div>
          </div>
          <div class="metric-card impact-filter-card" data-model-index="${m.model_index}" data-impact-filter="upgrades" style="cursor:pointer;">
            <h3>Upgrade Rate</h3>
            <div class="metric-value ${m.upgrade_rate > m.downgrade_rate ? 'positive' : ''}">${m.upgrade_rate}%</div>
            <div class="metric-count">(${m.raw_counts.upgrades} out of ${m.total_candidates})</div>
            <div class="metric-desc">Responses that moved to higher categories</div>
          </div>
          <div class="metric-card impact-filter-card" data-model-index="${m.model_index}" data-impact-filter="downgrades" style="cursor:pointer;">
            <h3>Downgrade Rate</h3>
            <div class="metric-value ${m.downgrade_rate > m.upgrade_rate ? 'negative' : ''}">${m.downgrade_rate}%</div>
            <div class="metric-count">(${m.raw_counts.downgrades} out of ${m.total_candidates})</div>
            <div class="metric-desc">Responses that moved to lower categories</div>
          </div>
          <div class="metric-card">
            <h3>Net Decision Bias</h3>
            <div class="metric-value ${biasClass}">${biasPrefix}${bias}%</div>
            <div class="metric-desc">Upgrade rate minus downgrade rate</div>
          </div>
        </div>

        <div class="confusion-matrix-section">
          <h3>Category Transition Matrix</h3>
          <div class="confusion-matrix">
            <table>
              <thead>
                <tr>
                  <th>From → To</th>
                  ${['A','B','C','D'].map((c) => `<th>${c}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${Object.entries(m.confusion_matrix).map(([from, row]) => `
                  <tr>
                    <td><strong>${from}</strong></td>
                    ${Object.entries(row).map(([to, val]) =>
                      `<td class="${from === to ? 'diagonal' : ''}">${val}</td>`
                    ).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="subcategory-analysis-section">
          <h3>Subcategory Analysis</h3>
          <div class="subcategory-metrics">
            <div class="subcategory-metric impact-filter-card" data-model-index="${m.model_index}" data-impact-filter="subcategory_changes" style="cursor:pointer;">
              <h4>Subcategory Change Rate</h4>
              <div class="metric-value">${m.subcategory_change_rate}%</div>
              <div class="metric-count">(${m.raw_counts.subcategory_changes} out of ${m.total_candidates})</div>
              <div class="metric-desc">Responses with any subcategory change</div>
            </div>
            <div class="subcategory-metric impact-filter-card" data-model-index="${m.model_index}" data-impact-filter="upgrades" style="cursor:pointer;">
              <h4>Upgrade Rate</h4>
              <div class="metric-value ${m.upgrade_rate > m.downgrade_rate ? 'positive' : ''}">${m.upgrade_rate}%</div>
              <div class="metric-count">(${m.raw_counts.upgrades} out of ${m.total_candidates})</div>
              <div class="metric-desc">Category upgrades</div>
            </div>
            <div class="subcategory-metric impact-filter-card" data-model-index="${m.model_index}" data-impact-filter="downgrades" style="cursor:pointer;">
              <h4>Downgrade Rate</h4>
              <div class="metric-value ${m.downgrade_rate > m.upgrade_rate ? 'negative' : ''}">${m.downgrade_rate}%</div>
              <div class="metric-count">(${m.raw_counts.downgrades} out of ${m.total_candidates})</div>
              <div class="metric-desc">Category downgrades</div>
            </div>
            <div class="subcategory-metric">
              <h4>Net Decision Bias</h4>
              <div class="metric-value ${biasClass}">${biasPrefix}${bias}%</div>
              <div class="metric-desc">Upgrade rate minus downgrade rate</div>
            </div>
          </div>

          <div class="subcategory-confusion-matrix-section">
            <h4>Subcategory Transition Matrix</h4>
            <div class="confusion-matrix">
              <table>
                <thead>
                  <tr>
                    <th>From → To</th>
                    ${subLabels.map((s) => `<th>${s}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${Object.keys(m.subcategory_confusion_matrix || {})
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map((from) => `
                      <tr>
                        <td><strong>${from}</strong></td>
                        ${subLabels.map((to) =>
                          `<td class="${from === to ? 'diagonal' : ''}">${
                            m.subcategory_confusion_matrix[from]?.[to] || 0
                          }</td>`
                        ).join('')}
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function buildCostComparisonTable(metrics) {
    const rows = metrics.map((m) => `
      <tr class="impact-cost-row" data-impact-model-index="${m.model_index}">
        <td style="padding:8px;border:1px solid #ddd;">${m.model_used || 'Unknown'}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;color:#2E7D32;font-weight:bold;">$${(m.total_cost || 0).toFixed(4)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">$${(m.avg_cost_per_row || 0).toFixed(4)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatDurationSeconds(m.avg_response_time_seconds || 0)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatDurationSeconds(m.total_response_time_seconds || 0)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${(m.total_input_tokens || 0).toLocaleString()}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${(m.total_output_tokens || 0).toLocaleString()}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${(m.total_reasoning_tokens || 0).toLocaleString()}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${(m.total_cached_tokens || 0).toLocaleString()}</td>
      </tr>
    `).join('');

    return `
      <div class="cost-comparison-section" style="margin-top:30px;border-top:1px solid #eee;padding-top:20px;">
        <h3>Cost & Timing Comparison</h3>
        <div class="table-container">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background-color:#f8f9fa;">
                ${['Model','Total Cost','Avg Cost/Row','Avg Response Time','Total Response Time','Input Tokens','Output Tokens','Reasoning Tokens','Cached Tokens']
                  .map((h) => `<th style="padding:10px;border:1px solid #ddd;text-align:${h === 'Model' ? 'left' : 'right'}">${h}</th>`)
                  .join('')}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ── Download section ──────────────────────────────────────
  function createDownloadSection(result) {
    const section = document.createElement('div');
    section.className = 'result-section';
    section.innerHTML = `
      <h2>Output Excel File</h2>
      <button class="download-btn" onclick="downloadOutput('${result.output_file}')">Download Output Excel</button>
    `;
    return section;
  }

  // ── Row Viewer section ────────────────────────────────────
  function createRowViewerSection() {
    const section = document.createElement('div');
    section.className = 'result-section';
    section.innerHTML = `
      <h2>Row Data Viewer</h2>
      <div class="form-row">
        <div class="form-group">
          <label for="rowSelector">Select Row Number:</label>
          <select id="rowSelector">
            <option value="">Choose a row...</option>
          </select>
        </div>
        <div class="form-group" id="modelSelectorGroup" style="display:none;">
          <label for="modelSelector">Select Model:</label>
          <select id="modelSelector"></select>
        </div>
        <div class="form-group">
          <label>&nbsp;</label>
          <button id="showResponsesBtn" style="display:none;">Show Responses</button>
        </div>
      </div>

      <div id="promptDisplay" style="display:none;">
        <h3>Prompts</h3>
        <div class="prompt-comparison">
          <div class="prompt-column">
            <h4>Old Prompt</h4>
            <div class="prompt-display" id="oldPromptContent"></div>
          </div>
          <div class="prompt-column">
            <h4>New Prompt</h4>
            <button id="editNewPromptBtn">Edit New Prompt</button>
            <div id="newPromptDisplay">
              <div class="prompt-display" id="newPromptContent"></div>
            </div>
            <div id="newPromptEditor" style="display:none;">
              <div id="newPromptTextarea" contenteditable="true"
                style="width:100%;min-height:200px;border:1px solid #ccc;padding:8px;white-space:pre-wrap;"></div>
              <button id="runEditedPromptBtn">Run Edited Prompt</button>
              <button id="cancelEditBtn">Cancel</button>
            </div>
            <div id="customResponse" style="display:none;">
              <h4>Custom Response</h4>
              <div class="schema-display" id="customResponseContent"></div>
            </div>
          </div>
        </div>
      </div>

      <div id="responseDisplay" style="display:none;">
        <h3>Responses</h3>
        <div class="prompt-comparison">
          <div class="prompt-column">
            <h4>Old Response</h4>
            <div class="model-info" id="oldModelInfo"
              style="background:#f0f4ff;padding:10px;border-radius:5px;margin-bottom:10px;font-size:0.9em;color:#667eea;font-weight:500;"></div>
            <div class="schema-display" id="oldResponseContent"></div>
          </div>
          <div class="prompt-column">
            <h4>New Response</h4>
            <div class="model-info" id="newModelInfo"
              style="background:#f0f4ff;padding:10px;border-radius:5px;margin-bottom:10px;font-size:0.9em;color:#667eea;font-weight:500;"></div>
            <div class="schema-display" id="newResponseContent"></div>
          </div>
        </div>
      </div>
    `;
    return section;
  }

  // ── Context menu ──────────────────────────────────────────
  function appendContextMenu() {
    if ($('textContextMenu')) return;
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'textContextMenu';
    menu.innerHTML = `
      <ul>
        <li data-action="string">Extract as String</li>
        <li data-action="json">Extract as JSON</li>
        <li data-action="pretty">Pretty Print</li>
      </ul>
    `;
    document.body.appendChild(menu);
  }

  // ── Preview panel ─────────────────────────────────────────
  function appendPreviewPanel() {
    if ($('previewOverlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'preview-overlay';
    overlay.id = 'previewOverlay';
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.className = 'formatting-preview-panel';
    panel.id = 'formattingPreviewPanel';
    panel.innerHTML = `
      <div class="preview-panel-header">
        <h3>Formatting Preview</h3>
        <button class="preview-close-btn" id="previewCloseBtn">×</button>
      </div>
      <div class="preview-panel-body">
        <div class="preview-info">
          <p><strong>Format Type:</strong> <span id="previewFormatType"></span></p>
          <p><strong>Tag Pattern:</strong> <span id="previewTagPattern"></span></p>
          <p><strong>Field:</strong> <span id="previewField"></span></p>
        </div>
        <div class="preview-comparison">
          <div class="preview-column">
            <h4>Before</h4>
            <div class="preview-content" id="previewBefore"></div>
          </div>
          <div class="preview-column">
            <h4>After</h4>
            <div class="preview-content" id="previewAfter"></div>
          </div>
        </div>
        <div class="preview-actions">
          <button class="preview-btn preview-btn-secondary" id="previewCancelBtn">Cancel</button>
          <button class="preview-btn preview-btn-primary" id="previewApplyBtn">Apply to This Row</button>
          <button class="preview-btn preview-btn-success" id="previewSaveBtn">Save & Apply to All</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
  }

  // ────────────────────────────────────────────────────────────
  // ROW SELECTOR & VIEWER INIT
  // ────────────────────────────────────────────────────────────
  function initRowSelector(result) {
    const rowSelector = $('rowSelector');
    allRowIndices = Array.from({ length: result.total_rows }, (_, i) => i);
    setRowSelectorOptions(allRowIndices, 'Choose a row...');

    rowSelector.addEventListener('change', async (e) => {
      if (e.target.value !== '') {
        await loadRowData(e.target.value);
      } else {
        hideRowData();
      }
    });
  }

  function setRowSelectorOptions(rowIndices, placeholderText) {
    const rowSelector = $('rowSelector');
    rowSelector.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = placeholderText;
    rowSelector.appendChild(placeholder);

    rowIndices.forEach((idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `Row ${Number(idx) + 1}`;
      rowSelector.appendChild(opt);
    });
  }

  function setActiveImpactCards(modelIndex, filterKey) {
    document.querySelectorAll('.impact-filter-card').forEach((card) => {
      const isActive =
        Number(card.dataset.modelIndex) === Number(modelIndex) &&
        card.dataset.impactFilter === filterKey;
      card.style.borderColor = isActive ? '#667eea' : '';
      card.style.boxShadow = isActive ? '0 0 0 2px rgba(102, 126, 234, 0.15)' : '';
    });
  }

  async function applyImpactFilter(modelIndex, filterKey, affectedRows) {
    const uniqueRows = Array.from(
      new Set((affectedRows || []).map((r) => Number(r)).filter((r) => Number.isInteger(r) && r >= 0))
    ).sort((a, b) => a - b);

    activeImpactFilter = { modelIndex: Number(modelIndex), filterKey };
    setActiveImpactCards(modelIndex, filterKey);

    const filterLabel = IMPACT_FILTER_LABELS[filterKey] || 'Selected metric';
    const placeholderText = uniqueRows.length
      ? `Choose affected row (${filterLabel})...`
      : `No rows found for ${filterLabel}`;

    setRowSelectorOptions(uniqueRows, placeholderText);

    const rowSection = $('rowSelector')?.closest('.result-section');
    if (rowSection) {
      rowSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (uniqueRows.length > 0) {
      $('rowSelector').value = String(uniqueRows[0]);
      await loadRowData(uniqueRows[0]);
    } else {
      hideRowData();
    }
  }

  function clearImpactFilter() {
    activeImpactFilter = null;
    setActiveImpactCards(null, '');
    setRowSelectorOptions(allRowIndices, 'Choose a row...');
    $('rowSelector').value = '';
    hideRowData();
  }

  function applyImpactModelVisibility(modelIndex) {
    document.querySelectorAll('.impact-metrics').forEach((block) => {
      const blockModelIndex = Number(block.dataset.impactModelIndex);
      const shouldShow = Number.isNaN(Number(modelIndex)) || blockModelIndex === Number(modelIndex);
      block.style.display = shouldShow ? '' : 'none';
    });
  }

  function initImpactModelFilter() {
    const selector = $('impactModelSelector');
    if (!selector) {
      activeImpactModelIndex = null;
      applyImpactModelVisibility(null);
      return;
    }

    selector.addEventListener('change', () => {
      const selectedValue = selector.value;
      activeImpactModelIndex = Number(selectedValue);
      applyImpactModelVisibility(activeImpactModelIndex);

      if (
        activeImpactFilter &&
        activeImpactModelIndex !== null &&
        activeImpactFilter.modelIndex !== activeImpactModelIndex
      ) {
        clearImpactFilter();
      }
    });

    activeImpactModelIndex = Number(selector.value);
    applyImpactModelVisibility(activeImpactModelIndex);
  }

  function initImpactMetricFilters(result) {
    const cards = document.querySelectorAll('.impact-filter-card');
    if (!cards.length) return;

    cards.forEach((card) => {
      card.addEventListener('click', async () => {
        const modelIndex = Number(card.dataset.modelIndex);
        const filterKey = card.dataset.impactFilter;

        const isSameFilter =
          activeImpactFilter &&
          activeImpactFilter.modelIndex === modelIndex &&
          activeImpactFilter.filterKey === filterKey;

        if (isSameFilter) {
          clearImpactFilter();
          return;
        }

        const metrics = (result.impact_metrics || []).find(
          (m) => Number(m.model_index) === modelIndex
        );
        const affectedRows = metrics?.affected_rows?.[filterKey] || [];
        await applyImpactFilter(modelIndex, filterKey, affectedRows);
      });
    });
  }

  function initShowResponsesBtn() {
    $('showResponsesBtn').addEventListener('click', () => {
      const display = $('responseDisplay');
      const btn     = $('showResponsesBtn');
      const isHidden = display.style.display === 'none';
      display.style.display = isHidden ? 'block' : 'none';
      btn.textContent = isHidden ? 'Hide Responses' : 'Show Responses';
    });
  }

  // ────────────────────────────────────────────────────────────
  // EDIT PROMPT FLOW
  // ────────────────────────────────────────────────────────────
  function initEditPromptFlow(newSchema) {
    $('editNewPromptBtn').addEventListener('click', () => {
      $('newPromptTextarea').textContent = $('newPromptContent').textContent;
      $('newPromptDisplay').style.display = 'none';
      $('newPromptEditor').style.display  = 'block';
      $('customResponse').style.display   = 'none';
    });

    $('cancelEditBtn').addEventListener('click', () => {
      $('newPromptDisplay').style.display = 'block';
      $('newPromptEditor').style.display  = 'none';
      $('customResponse').style.display   = 'none';
    });

    $('runEditedPromptBtn').addEventListener('click', async () => {
      const prompt = $('newPromptTextarea').textContent;
      try {
        const fd = new FormData();
        fd.append('prompt', prompt);
        fd.append('schema', newSchema);

        const data = await apiFetch(API.RUN_CUSTOM_PROMPT, { method: 'POST', body: fd });
        $('customResponseContent').textContent = JSON.stringify(data.response, null, 2);
      } catch (error) {
        $('customResponseContent').textContent = `Error: ${error.message}`;
      } finally {
        $('customResponse').style.display = 'block';
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // TEXT SELECTION & FORMATTING
  // ────────────────────────────────────────────────────────────

  // Shared selection state (closure-scoped)
  let selectedText    = '';
  let selectedElement = null;
  let selectedField   = '';
  let currentFormatting = null;

  function showContextMenu(x, y) {
    const menu = $('textContextMenu');
    menu.style.left    = `${x}px`;
    menu.style.top     = `${y}px`;
    menu.style.display = 'block';
  }

  function hideContextMenu() {
    $('textContextMenu').style.display = 'none';
  }

  function showPreviewPanel(formatType, tagPattern, field, before, after) {
    $('previewFormatType').textContent = formatType.toUpperCase();
    $('previewTagPattern').textContent = tagPattern || 'None (entire field)';
    $('previewField').textContent      = field;
    $('previewBefore').textContent     = before;
    $('previewAfter').textContent      = after;
    $('previewOverlay').style.display          = 'block';
    $('formattingPreviewPanel').style.display  = 'block';
  }

  function hidePreviewPanel() {
    $('previewOverlay').style.display         = 'none';
    $('formattingPreviewPanel').style.display = 'none';
    currentFormatting = null;
  }

  /**
   * Build and attach mouseup listeners to content divs.
   * Returns the attach function so it can be called again after row changes.
   */
  function buildSelectionListeners() {
    function handleTextSelection(event, elementId, field) {
      const x = event.pageX;
      const y = event.pageY;

      setTimeout(() => {
        const sel = window.getSelection().toString().trim();
        if (sel) {
          selectedText    = sel;
          selectedElement = $(elementId);
          selectedField   = field;
          showContextMenu(x, y);
        }
      }, 10);
    }

    return function attach() {
      Object.entries(FIELD_MAP).forEach(([id, field]) => {
        const el = $(id);
        if (!el) return;

        if (el._selectionHandler) {
          el.removeEventListener('mouseup', el._selectionHandler);
        }
        const handler = (e) => handleTextSelection(e, id, field);
        el._selectionHandler = handler;
        el.addEventListener('mouseup', handler);
      });
    };
  }

  // Global hide context-menu on outside click
  document.addEventListener('click', (e) => {
    const menu = $('textContextMenu');
    if (menu && !menu.contains(e.target)) hideContextMenu();
  });

  // Context menu action dispatch (delegated — works even after re-renders)
  document.addEventListener('click', async (e) => {
    const li = e.target.closest('#textContextMenu li');
    if (!li) return;

    const formatType = li.getAttribute('data-action');
    hideContextMenu();

    if (selectedText && selectedElement && selectedField) {
      await showFormattingPreview(selectedField, selectedText, formatType);
    }
  });

  async function showFormattingPreview(field, text, formatType) {
    try {
      const rowIndex = $('rowSelector').value;
      if (rowIndex === '') { alert('Please select a row first.'); return; }

      const tagPattern      = detectTag(text);
      const hasTags         = tagPattern !== null;
      const fullFieldContent = selectedElement.textContent;

      const data = await apiFetch(API.FORMAT_CONTENT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row_index: parseInt(rowIndex, 10),
          field,
          tag_pattern: tagPattern,
          format_type: formatType,
          has_tags: hasTags,
        }),
      });

      currentFormatting = {
        row_index: parseInt(rowIndex, 10),
        field,
        tag_pattern: tagPattern,
        format_type: formatType,
        has_tags: hasTags,
        formatted_text: data.formatted_text,
        original_text: fullFieldContent,
      };

      const beforeText = hasTags ? text : fullFieldContent;
      showPreviewPanel(formatType, tagPattern, field, beforeText, data.formatted_text);
    } catch (error) {
      alert(`Error generating preview: ${error.message}`);
    }
  }

  // Preview panel button handlers (set up once, after panel is appended)
  function initPreviewPanelHandlers() {
    [$('previewCloseBtn'), $('previewCancelBtn'), $('previewOverlay')].forEach(
      (el) => el?.addEventListener('click', hidePreviewPanel)
    );

    $('previewApplyBtn').addEventListener('click', () => {
      if (!currentFormatting) return;

      if (currentFormatting.has_tags && currentFormatting.tag_pattern) {
        const tag = currentFormatting.tag_pattern;
        const pattern = new RegExp(`<${tag}>(.*?)<\\/${tag}>`, 's');
        selectedElement.textContent = currentFormatting.original_text.replace(
          pattern,
          `<${tag}>${currentFormatting.formatted_text}</${tag}>`
        );
      } else {
        selectedElement.textContent = currentFormatting.formatted_text;
      }

      hidePreviewPanel();
      alert('Changes applied to this row (temporary). Click "Save & Apply to All" to persist changes.');
    });

    $('previewSaveBtn').addEventListener('click', async () => {
      if (!currentFormatting) return;
      try {
        const data = await apiFetch(API.SAVE_FORMATTING, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...currentFormatting, apply_to_all: true }),
        });
        await loadRowData(currentFormatting.row_index);
        hidePreviewPanel();
        alert(`Success! Formatting applied to ${data.affected_rows} row(s) and saved to database.`);
      } catch (error) {
        alert(`Error saving formatting: ${error.message}`);
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // ROW DATA LOADER
  // ────────────────────────────────────────────────────────────
  async function loadRowData(rowIndex) {
    try {
      const data = await apiFetch(API.ROW_DATA(rowIndex));
      currentRowData = data;

      $('oldPromptContent').textContent = data.old_prompt;
      $('newPromptContent').textContent = data.new_prompt;
      $('promptDisplay').style.display  = 'block';

      const modelSelect = $('modelSelector');
      const modelGroup  = $('modelSelectorGroup');

      const updateDisplay = (idx) => {
        let response  = '';
        let modelInfo = '';

        if (data.model_responses?.length > 0) {
          const match = data.model_responses.find((r) => r.model_index == idx);
          if (match) {
            response  = match.response;
            modelInfo = `Model Used: ${match.model_used}`;
          }
        } else {
          response  = data.new_response || '';
          modelInfo = data.new_model_used ? `Model Used: ${data.new_model_used}` : '';
        }

        $('oldResponseContent').textContent = data.old_response;
        $('newResponseContent').textContent = response;
        $('oldModelInfo').textContent       = 'Old Response';
        $('newModelInfo').textContent       = modelInfo;
      };

      if (data.model_responses?.length > 0) {
        modelSelect.innerHTML = '';
        data.model_responses.forEach((m) => {
          const opt = document.createElement('option');
          opt.value       = m.model_index;
          opt.textContent = m.model_used;
          modelSelect.appendChild(opt);
        });
        modelGroup.style.display = 'block';
        modelSelect.onchange = (e) => updateDisplay(e.target.value);
        updateDisplay(data.model_responses[0].model_index);
      } else {
        modelGroup.style.display = 'none';
        updateDisplay(0);
      }

      $('showResponsesBtn').style.display = 'block';

      // Reset edit mode
      $('newPromptDisplay').style.display = 'block';
      $('newPromptEditor').style.display  = 'none';
      $('customResponse').style.display   = 'none';

      // Re-attach selection listeners
      if (typeof attachSelectionListeners === 'function') {
        attachSelectionListeners();
      }
    } catch (error) {
      displayError(`Failed to load row data: ${error.message}`);
    }
  }

  function hideRowData() {
    ['promptDisplay', 'responseDisplay'].forEach((id) => {
      $(id).style.display = 'none';
    });
    $('showResponsesBtn').style.display  = 'none';
    $('modelSelectorGroup').style.display = 'none';
    $('newPromptDisplay').style.display  = 'block';
    $('newPromptEditor').style.display   = 'none';
    $('customResponse').style.display    = 'none';
    ['oldResponseContent','newResponseContent','oldModelInfo','newModelInfo'].forEach(
      (id) => { $(id).textContent = ''; }
    );
    currentRowData = null;
  }
});