/**
 * Fix for the getBotInfo unknown command error
 * 
 * The issue is that WebSocketManager is sending 'getBotInfo' command, but it's not defined in the server side
 * We need to update the WebSocketManager to use a supported command instead
 */

// In web/js/modules/admin.js - Replace the getBotInfo command with serverStatus
// Find this function:
function updateSystemInfo() {
    // Original code with issue:
    // WebSocketManager.sendMessage({ command: 'getBotInfo' });
    
    // Modified code:
    WebSocketManager.sendMessage({ command: 'start' }, (response) => {
        // This will get the server status without requiring a specific getBotInfo command
    });
    
    // Server info update interval
    setInterval(() => {
        // Original code with issue:
        // WebSocketManager.sendMessage({ command: 'getBotInfo' });
        
        // Modified code:
        WebSocketManager.sendMessage({ command: 'start' }, (response) => {
            // This will periodically get the server status
        });
    }, 5000);
}

// Also update the handler function to use serverStatus response
WebSocketManager.messageHandlers['serverStatus'] = (message) => {
    updateBotInfo(message);
};

/**
 * Fix for the non-animating GIF logo
 * 
 * The issue may be with how the GIF is loaded or referenced
 * Let's ensure the GIF loads properly and has proper MIME type handling
 */

// In web/index.html - Update the GIF loading method
// Ensure the GIF is properly loaded from a reliable source
document.addEventListener('DOMContentLoaded', function() {
    // Force reload the GIF to ensure animation works
    const mainLogo = document.querySelector('.main-logo');
    if (mainLogo) {
        const src = mainLogo.src;
        mainLogo.src = '';
        setTimeout(() => {
            mainLogo.src = src + '?t=' + new Date().getTime(); // Add cache busting
        }, 100);
    }
    
    // Same for the loading logo
    const loadingLogo = document.querySelector('.loading-logo img');
    if (loadingLogo) {
        const src = loadingLogo.src;
        loadingLogo.src = '';
        setTimeout(() => {
            loadingLogo.src = src + '?t=' + new Date().getTime(); // Add cache busting
        }, 100);
    }
});

/**
 * Fix for the module info text visibility issue
 * 
 * The text and background in module management have the same color, making text invisible
 */

// In web/js/modules/module-mgmt.js - Add styles to ensure text visibility
function showModuleModal(fileName, module) {
    currentModule = fileName;
    
    // Update modal content
    document.getElementById('modal-module-name').textContent = module.name || fileName;
    document.getElementById('modal-module-description').textContent = module.description || '설명 없음';
    document.getElementById('modal-module-version').textContent = module.version || '1.0.0';
    document.getElementById('modal-module-status').textContent = module.enabled ? '활성화' : '비활성화';
    
    // Fix for text visibility
    const infoItems = document.querySelectorAll('.module-info-details .info-item');
    infoItems.forEach(item => {
        // Ensure label is visible
        const label = item.querySelector('.info-label');
        if (label) {
            label.style.color = '#333'; // Darker color for labels
        }
        
        // Ensure value is visible
        const value = item.querySelector('.info-value');
        if (value) {
            value.style.color = '#333'; // Darker color for values
            value.style.backgroundColor = '#f0f0f0'; // Lighter background for contrast
        }
    });
    
    // Fix command tags visibility
    const commandsContainer = document.getElementById('modal-module-commands');
    if (module.commands && module.commands.length > 0) {
        let commandsHTML = '';
        module.commands.forEach(command => {
            commandsHTML += `<span class="command-tag" style="color: #333; background-color: #e0e0e0;">${command}</span>`;
        });
        commandsContainer.innerHTML = commandsHTML;
    } else {
        commandsContainer.textContent = '등록된 명령어가 없습니다.';
        commandsContainer.style.color = '#333';
    }
    
    // Show modal
    document.getElementById('module-info-modal').style.display = 'block';
}

/**
 * Fix for inconsistent text box colors
 * 
 * Standardize the text input styling across all modules
 */

// Add this to a new or existing onload handler
document.addEventListener('DOMContentLoaded', function() {
    // Wait until the loading animation completes
    setTimeout(() => {
        // Apply consistent styling to all text inputs across modules
        const standardizeInputs = function() {
            // Select all inputs across modules
            const allInputs = document.querySelectorAll('input[type="text"], input[type="password"], input[type="url"], textarea, select');
            
            allInputs.forEach(input => {
                // Apply consistent styling
                input.style.backgroundColor = '#333';
                input.style.color = '#f5f5f5';
                input.style.border = '1px solid #444';
                input.style.padding = '10px';
                input.style.borderRadius = '4px';
                
                // Add focus styling
                input.addEventListener('focus', function() {
                    this.style.borderColor = '#3498db';
                    this.style.outline = 'none';
                });
                
                // Remove focus styling
                input.addEventListener('blur', function() {
                    this.style.borderColor = '#444';
                });
            });
        };
        
        // Call immediately
        standardizeInputs();
        
        // Also call whenever a module is activated
        const moduleLinks = document.querySelectorAll('.side-bar a');
        moduleLinks.forEach(link => {
            link.addEventListener('click', function() {
                // Give time for the module to load
                setTimeout(standardizeInputs, 500);
            });
        });
    }, 6500); // Wait for the loading animation
});