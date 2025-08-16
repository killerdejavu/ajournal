// Application state
let journals = [];
let currentJournal = null;
let isEditing = false;
let originalContent = '';

// API base URL
const API_BASE = '/api';

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    loadJournals();
    loadStatus();
    loadEnvStatus();
    loadConfig();
    
    // Set up search
    document.getElementById('journal-search').addEventListener('input', filterJournals);
});

// Tab management
function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active class from all nav tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName + '-tab').classList.add('active');
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
    
    // Load tab-specific data
    if (tabName === 'status') {
        loadStatus();
    } else if (tabName === 'setup') {
        loadEnvStatus();
        loadConfig();
    }
}

// Journal management
async function loadJournals() {
    try {
        document.getElementById('journals-loading').style.display = 'block';
        document.getElementById('journals-container').innerHTML = '';
        
        const response = await fetch(`${API_BASE}/journals`);
        journals = await response.json();
        
        document.getElementById('journals-loading').style.display = 'none';
        
        if (journals.length === 0) {
            document.getElementById('journals-container').innerHTML = `
                <div class="loading">
                    <i class="fas fa-book"></i>
                    <div>No journals found</div>
                    <small>Run a sync and generate journals to get started</small>
                </div>
            `;
            return;
        }
        
        displayJournals(journals);
        updateJournalCount();
    } catch (error) {
        console.error('Error loading journals:', error);
        document.getElementById('journals-loading').innerHTML = `
            <div class="loading text-error">
                <i class="fas fa-exclamation-circle"></i>
                Error loading journals: ${error.message}
            </div>
        `;
    }
}

function displayJournals(journalsToDisplay) {
    const container = document.getElementById('journals-container');
    
    if (journalsToDisplay.length === 0) {
        container.innerHTML = `
            <div class="loading">
                <i class="fas fa-search"></i>
                <div>No journals match your search</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = journalsToDisplay.map(journal => `
        <div class="journal-item" onclick="selectJournal('${journal.id}')">
            <div class="journal-item-title">${journal.title}</div>
            <div class="journal-item-date">${formatDate(journal.date)}</div>
            <div class="journal-item-preview">${journal.preview}</div>
        </div>
    `).join('');
}

async function selectJournal(journalId) {
    try {
        // Update visual selection
        document.querySelectorAll('.journal-item').forEach(item => {
            item.classList.remove('active');
        });
        event.currentTarget.classList.add('active');
        
        // Load journal content
        const response = await fetch(`${API_BASE}/journals/${journalId}`);
        currentJournal = await response.json();
        
        displayJournalContent();
    } catch (error) {
        console.error('Error loading journal:', error);
        alert('Error loading journal: ' + error.message);
    }
}

function displayJournalContent() {
    if (!currentJournal) return;
    
    document.querySelector('.viewer-placeholder').style.display = 'none';
    document.getElementById('journal-content').style.display = 'block';
    
    document.getElementById('journal-title').textContent = `Journal - ${formatDate(currentJournal.date)}`;
    document.getElementById('journal-meta').innerHTML = `
        <strong>Date:</strong> ${formatDate(currentJournal.date)} | 
        <strong>Size:</strong> ${formatBytes(currentJournal.size)} | 
        <strong>Modified:</strong> ${formatDateTime(currentJournal.modified)}
    `;
    
    document.getElementById('journal-view').innerHTML = renderMarkdown(currentJournal.content);
    document.getElementById('journal-edit').value = currentJournal.content;
    
    // Reset edit state
    exitEditMode();
}

function filterJournals() {
    const query = document.getElementById('journal-search').value.toLowerCase();
    
    if (!query) {
        displayJournals(journals);
        return;
    }
    
    const filtered = journals.filter(journal => 
        journal.title.toLowerCase().includes(query) ||
        journal.content.toLowerCase().includes(query) ||
        journal.date.includes(query)
    );
    
    displayJournals(filtered);
}

// Journal editing
function editJournal() {
    if (!currentJournal) return;
    
    isEditing = true;
    originalContent = currentJournal.content;
    
    document.getElementById('journal-view').style.display = 'none';
    document.getElementById('journal-edit').style.display = 'block';
    document.getElementById('save-btn').style.display = 'inline-flex';
    document.getElementById('cancel-btn').style.display = 'inline-flex';
    
    document.querySelector('[onclick="editJournal()"]').style.display = 'none';
    
    document.getElementById('journal-edit').focus();
}

async function saveJournal() {
    if (!currentJournal || !isEditing) return;
    
    const newContent = document.getElementById('journal-edit').value;
    
    try {
        const response = await fetch(`${API_BASE}/journals/${currentJournal.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: newContent })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save journal');
        }
        
        currentJournal.content = newContent;
        displayJournalContent();
        
        // Update the journal in the list
        const journalIndex = journals.findIndex(j => j.id === currentJournal.id);
        if (journalIndex !== -1) {
            journals[journalIndex].preview = newContent.substring(0, 200) + '...';
        }
        
        // Refresh the display if search is active
        if (document.getElementById('journal-search').value) {
            filterJournals();
        } else {
            displayJournals(journals);
        }
        
        showNotification('Journal saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving journal:', error);
        showNotification('Error saving journal: ' + error.message, 'error');
    }
}

function cancelEdit() {
    if (!isEditing) return;
    
    document.getElementById('journal-edit').value = originalContent;
    exitEditMode();
}

function exitEditMode() {
    isEditing = false;
    
    document.getElementById('journal-view').style.display = 'block';
    document.getElementById('journal-edit').style.display = 'none';
    document.getElementById('save-btn').style.display = 'none';
    document.getElementById('cancel-btn').style.display = 'none';
    
    document.querySelector('[onclick="editJournal()"]').style.display = 'inline-flex';
}

// Status management
async function loadStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const status = await response.json();
        
        document.getElementById('sync-status').innerHTML = formatSyncStatus(status);
    } catch (error) {
        console.error('Error loading status:', error);
        document.getElementById('sync-status').innerHTML = `
            <span class="text-error">Error: ${error.message}</span>
        `;
    }
}

function formatSyncStatus(status) {
    if (!status || typeof status === 'string') {
        return '<span class="text-muted">No sync data available</span>';
    }
    
    const integrations = ['slack', 'github', 'gcal', 'jira'];
    
    return integrations.map(integration => {
        const timestamp = status[integration];
        if (timestamp) {
            return `<div><strong>${integration.toUpperCase()}:</strong> ${formatDateTime(timestamp)}</div>`;
        }
        return `<div><strong>${integration.toUpperCase()}:</strong> <span class="text-muted">Never synced</span></div>`;
    }).join('');
}

function updateJournalCount() {
    document.getElementById('journal-count').textContent = journals.length;
}

// Environment status
async function loadEnvStatus() {
    try {
        const response = await fetch(`${API_BASE}/env-status`);
        const envStatus = await response.json();
        
        const container = document.getElementById('env-status');
        container.innerHTML = Object.entries(envStatus).map(([key, configured]) => `
            <div class="env-item ${configured ? 'configured' : 'missing'}">
                <i class="fas fa-${configured ? 'check-circle' : 'times-circle'}"></i>
                <span>${key}</span>
                ${configured ? '<span class="text-success">✓</span>' : '<span class="text-error">Missing</span>'}
            </div>
        `).join('');
        
        // Update integration status
        const integrationStatus = document.getElementById('integration-status');
        const totalIntegrations = Object.keys(envStatus).length;
        const configuredIntegrations = Object.values(envStatus).filter(Boolean).length;
        
        integrationStatus.innerHTML = `
            <div>${configuredIntegrations}/${totalIntegrations} configured</div>
            <div class="text-muted">Missing: ${Object.entries(envStatus).filter(([k, v]) => !v).map(([k]) => k).join(', ') || 'None'}</div>
        `;
    } catch (error) {
        console.error('Error loading env status:', error);
        document.getElementById('env-status').innerHTML = `
            <span class="text-error">Error loading environment status</span>
        `;
    }
}

// Configuration management
async function loadConfig() {
    try {
        const response = await fetch(`${API_BASE}/config`);
        
        if (response.status === 404) {
            document.getElementById('config-editor').value = '// Configuration file not found\n// Please create config.json from config.example.json';
            return;
        }
        
        const config = await response.json();
        document.getElementById('config-editor').value = JSON.stringify(config, null, 2);
    } catch (error) {
        console.error('Error loading config:', error);
        document.getElementById('config-editor').value = `// Error loading configuration: ${error.message}`;
    }
}

async function saveConfig() {
    try {
        const configText = document.getElementById('config-editor').value;
        const config = JSON.parse(configText);
        
        const response = await fetch(`${API_BASE}/config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        
        if (!response.ok) {
            throw new Error('Failed to save configuration');
        }
        
        showNotification('Configuration saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving config:', error);
        if (error instanceof SyntaxError) {
            showNotification('Invalid JSON format: ' + error.message, 'error');
        } else {
            showNotification('Error saving configuration: ' + error.message, 'error');
        }
    }
}

function resetConfig() {
    if (confirm('Are you sure you want to reset the configuration to defaults?')) {
        // This would ideally load from config.example.json
        document.getElementById('config-editor').value = `{
  "integrations": {
    "slack": { "enabled": true },
    "github": { "enabled": true },
    "gcal": { "enabled": true },
    "jira": { "enabled": false }
  },
  "ai": {
    "model": "claude-3-haiku-20240307",
    "maxTokens": 1000,
    "categorizeWork": true,
    "includeMetrics": true
  }
}`;
    }
}

// Modal management
function showRunDialog() {
    document.getElementById('run-dialog').classList.add('show');
    document.getElementById('run-output').style.display = 'none';
    
    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('run-start-date').value = today;
    document.getElementById('run-end-date').value = '';
}

function closeRunDialog() {
    document.getElementById('run-dialog').classList.remove('show');
}

function toggleRunMethod() {
    const method = document.querySelector('input[name="run-method"]:checked').value;
    const recentOption = document.getElementById('recent-days-option');
    const specificOption = document.getElementById('specific-date-option');
    
    if (method === 'recent') {
        recentOption.style.display = 'block';
        specificOption.style.display = 'none';
    } else {
        recentOption.style.display = 'none';
        specificOption.style.display = 'block';
    }
}

function showAdvancedDialog() {
    document.getElementById('advanced-dialog').classList.add('show');
    document.getElementById('advanced-output').style.display = 'none';
    
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('advanced-generate-date').value = today;
}

function closeAdvancedDialog() {
    document.getElementById('advanced-dialog').classList.remove('show');
}

function showConfigDialog() {
    loadConfig().then(() => {
        document.getElementById('config-modal-editor').value = document.getElementById('config-editor').value;
        document.getElementById('config-dialog').classList.add('show');
    });
}

function closeConfigDialog() {
    document.getElementById('config-dialog').classList.remove('show');
}

async function saveModalConfig() {
    try {
        const configText = document.getElementById('config-modal-editor').value;
        const config = JSON.parse(configText);
        
        const response = await fetch(`${API_BASE}/config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        
        if (!response.ok) {
            throw new Error('Failed to save configuration');
        }
        
        document.getElementById('config-editor').value = configText;
        closeConfigDialog();
        showNotification('Configuration saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving config:', error);
        if (error instanceof SyntaxError) {
            showNotification('Invalid JSON format: ' + error.message, 'error');
        } else {
            showNotification('Error saving configuration: ' + error.message, 'error');
        }
    }
}

// Main update function (sync + generate)
async function runUpdate() {
    try {
        const method = document.querySelector('input[name="run-method"]:checked').value;
        let requestBody = {};
        
        if (method === 'recent') {
            // Handle recent days method
            const timeframe = document.getElementById('run-timeframe').value;
            if (timeframe === 'today') {
                requestBody.days = 1;
            } else {
                requestBody.days = parseInt(timeframe);
            }
        } else {
            // Handle specific date/range method
            const startDate = document.getElementById('run-start-date').value;
            const endDate = document.getElementById('run-end-date').value;
            
            if (!startDate) {
                showNotification('Please select a start date', 'error');
                return;
            }
            
            if (endDate && endDate < startDate) {
                showNotification('End date cannot be before start date', 'error');
                return;
            }
            
            requestBody.startDate = startDate;
            if (endDate) {
                requestBody.endDate = endDate;
            }
        }
        
        document.getElementById('run-output').style.display = 'block';
        document.getElementById('run-output').textContent = 'Updating your journal...\n';
        
        // Use the existing 'run' CLI command which does both sync and generate
        const response = await fetch(`${API_BASE}/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('run-output').textContent += result.output;
            showNotification('Journal updated successfully!', 'success');
            
            // Refresh status and journals
            setTimeout(() => {
                loadStatus();
                loadJournals();
            }, 1000);
        } else {
            document.getElementById('run-output').textContent += 'Error: ' + result.error;
            
            // Check if this is a token expiry error
            if (result.needsTokenRefresh) {
                showTokenRefreshDialog();
            } else {
                showNotification('Update failed: ' + result.message, 'error');
            }
        }
    } catch (error) {
        console.error('Error updating journal:', error);
        document.getElementById('run-output').textContent += 'Network error: ' + error.message;
        showNotification('Update failed: ' + error.message, 'error');
    }
}

// Advanced sync operations
async function runAdvancedSync() {
    try {
        const integration = document.getElementById('advanced-sync-integration').value;
        const days = parseInt(document.getElementById('advanced-sync-days').value) || 1;
        
        document.getElementById('advanced-output').style.display = 'block';
        document.getElementById('advanced-output').textContent = 'Starting sync...\n';
        
        const response = await fetch(`${API_BASE}/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ integration, days })
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('advanced-output').textContent += result.output;
            showNotification('Sync completed successfully!', 'success');
            
            // Refresh status and journals
            setTimeout(() => {
                loadStatus();
                loadJournals();
            }, 1000);
        } else {
            document.getElementById('advanced-output').textContent += 'Error: ' + result.error;
            showNotification('Sync failed: ' + result.message, 'error');
        }
    } catch (error) {
        console.error('Error running sync:', error);
        document.getElementById('advanced-output').textContent += 'Network error: ' + error.message;
        showNotification('Sync failed: ' + error.message, 'error');
    }
}

// Advanced generate operations
async function runAdvancedGenerate() {
    try {
        const generateType = document.querySelector('input[name="advanced-generate-type"]:checked').value;
        let requestBody = {};
        
        if (generateType === 'date') {
            requestBody.date = document.getElementById('advanced-generate-date').value;
        } else if (generateType === 'range') {
            requestBody.range = parseInt(document.getElementById('advanced-generate-range').value) || 7;
        }
        
        document.getElementById('advanced-output').style.display = 'block';
        document.getElementById('advanced-output').textContent = 'Generating journals...\n';
        
        const response = await fetch(`${API_BASE}/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('advanced-output').textContent += result.output;
            showNotification('Journals generated successfully!', 'success');
            
            // Refresh journals
            setTimeout(() => {
                loadJournals();
            }, 1000);
        } else {
            document.getElementById('advanced-output').textContent += 'Error: ' + result.error;
            showNotification('Generation failed: ' + result.message, 'error');
        }
    } catch (error) {
        console.error('Error generating journals:', error);
        document.getElementById('advanced-output').textContent += 'Network error: ' + error.message;
        showNotification('Generation failed: ' + error.message, 'error');
    }
}

// Utility functions
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function renderMarkdown(text) {
    // Configure marked for better rendering
    marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: true,
        mangle: false,
        sanitize: false
    });
    
    // Render markdown to HTML
    const rawHtml = marked.parse(text);
    
    // Sanitize the HTML for security
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'br', 'strong', 'b', 'em', 'i', 'u',
            'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
            'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'hr', 'del', 'ins', 'mark', 'sup', 'sub'
        ],
        ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'id', 'class']
    });
    
    return cleanHtml;
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        color: white;
        font-weight: 500;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        max-width: 400px;
    `;
    
    if (type === 'success') {
        notification.style.backgroundColor = '#38a169';
    } else if (type === 'error') {
        notification.style.backgroundColor = '#e53e3e';
    } else {
        notification.style.backgroundColor = '#2b6cb0';
    }
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Close modals when clicking outside
document.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('show');
    }
});

// Google Calendar token refresh dialog
async function showTokenRefreshDialog() {
    try {
        // Get the auth URL from the server
        const response = await fetch(`${API_BASE}/gcal-token-status`);
        const tokenInfo = await response.json();
        
        if (tokenInfo.needsRefresh && tokenInfo.authUrl) {
            // Show modal with token refresh instructions
            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>🔄 Google Calendar Token Refresh Required</h3>
                        <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p><strong>Your Google Calendar token has expired and needs to be refreshed.</strong></p>
                        <p>To continue syncing your Google Calendar data:</p>
                        <ol>
                            <li>Click the button below to open the Google authorization page</li>
                            <li>Sign in with your Google account and approve the permissions</li>
                            <li>Copy the authorization code from the success page</li>
                            <li>Run the command: <code>node setup-google-oauth.js</code> and paste the code</li>
                            <li>Try your journal update again</li>
                        </ol>
                        <div class="modal-actions">
                            <button class="btn btn-primary" onclick="window.open('${tokenInfo.authUrl}', '_blank')">
                                <i class="fas fa-external-link-alt"></i> Open Authorization Page
                            </button>
                            <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">
                                Cancel
                            </button>
                        </div>
                        <div class="mt-3">
                            <small class="text-muted">
                                <strong>Command to run after getting the code:</strong><br>
                                <code>node setup-google-oauth.js</code>
                            </small>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            showNotification('Token refresh failed: ' + (tokenInfo.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error showing token refresh dialog:', error);
        showNotification('Failed to get token refresh URL: ' + error.message, 'error');
    }
}