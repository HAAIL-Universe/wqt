// ====== Customer Selector Modal Functions ======

// Customer/location data structure
let customerLocationMap = {};

// Build the map from existing codes
function buildCustomerLocationMap() {
  const allCodes = Array.from(new Set([...(DEFAULT_CODES || []), ...(customCodes || [])]));
  // Sort all codes alphabetically first
  allCodes.sort((a, b) => a.localeCompare(b));
  
  customerLocationMap = {};
  
  allCodes.forEach(code => {
    if (code.length !== 6) return;
    
    const prefix = code.slice(0, 3).toUpperCase();
    const suffix = code.slice(3, 6).toUpperCase();
    
    if (!customerLocationMap[prefix]) {
      customerLocationMap[prefix] = [];
    }
    
    customerLocationMap[prefix].push({
      suffix: suffix,
      fullCode: code
    });
  });
  
  // Ensure locations within each customer are sorted alphabetically
  Object.keys(customerLocationMap).forEach(prefix => {
    customerLocationMap[prefix].sort((a, b) => a.fullCode.localeCompare(b.fullCode));
  });
}

// Open the modal
function openCustomerModal() {
  buildCustomerLocationMap();
  
  const modal = document.getElementById('customerSelectorModal');
  if (!modal) {
    console.error('Customer selector modal not found in DOM');
    return;
  }
  
  // Show modal
  modal.style.display = 'flex';
  
  // Reset to customer list view
  showCustomerListView();
  
  // Render customer groups
  renderCustomerGroups();
}

// Close the modal
function closeCustomerModal() {
  const modal = document.getElementById('customerSelectorModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Show customer list view (hide others)
function showCustomerListView() {
  const groupsContainer = document.getElementById('customer-groups');
  const locationsContainer = document.getElementById('customer-locations');
  const addForm = document.getElementById('add-customer-form');
  const footer = document.querySelector('.modal-footer');
  
  if (groupsContainer) groupsContainer.style.display = 'block';
  if (locationsContainer) locationsContainer.style.display = 'none';
  if (addForm) addForm.style.display = 'none';
  if (footer) footer.style.display = 'block';
}

// Render grouped customer list
function renderCustomerGroups() {
  const container = document.getElementById('customer-groups');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Get customer prefixes sorted alphabetically
  const sortedPrefixes = Object.keys(customerLocationMap).sort((a, b) => a.localeCompare(b));
  
  if (sortedPrefixes.length === 0) {
    const noResults = document.createElement('div');
    noResults.className = 'hint';
    noResults.style.textAlign = 'center';
    noResults.style.padding = '20px';
    noResults.textContent = 'No customers available';
    container.appendChild(noResults);
    return;
  }
  
  sortedPrefixes.forEach(prefix => {
    const locations = customerLocationMap[prefix];
    
    // Single item to click (shows locations for this prefix)
    const itemDiv = document.createElement('div');
    itemDiv.className = 'customer-item';
    itemDiv.onclick = () => showLocationSelection(prefix);
    
    const prefixSpan = document.createElement('span');
    prefixSpan.className = 'customer-item-prefix';
    prefixSpan.textContent = prefix.toUpperCase();
    
    const countSpan = document.createElement('span');
    countSpan.className = 'customer-item-count';
    countSpan.textContent = locations.length.toString();
    
    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'customer-item-arrow';
    arrowSpan.textContent = '→';
    
    const leftDiv = document.createElement('div');
    leftDiv.appendChild(prefixSpan);
    leftDiv.appendChild(countSpan);
    
    itemDiv.appendChild(leftDiv);
    itemDiv.appendChild(arrowSpan);
    
    container.appendChild(itemDiv);
  });
}

// Show locations for a customer prefix
function showLocationSelection(prefix) {
  const locations = customerLocationMap[prefix];
  if (!locations) return;
  
  const groupsContainer = document.getElementById('customer-groups');
  const locationsContainer = document.getElementById('customer-locations');
  const locationsList = document.getElementById('locations-list');
  const footer = document.querySelector('.modal-footer');
  
  // Hide groups, show locations
  if (groupsContainer) groupsContainer.style.display = 'none';
  if (locationsContainer) locationsContainer.style.display = 'flex';
  if (footer) footer.style.display = 'none';
  
  // Render locations as compact square buttons (grid keypad style)
  if (locationsList) {
    locationsList.innerHTML = '';
    
    locations.forEach(loc => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.style.cssText = 'padding:10px 12px; min-width:90px; max-width:95px; display:flex; flex-direction:column; align-items:center; text-align:center; border-radius:8px;';
      btn.onclick = () => selectCustomerLocation(loc.fullCode);
      
      const codeSpan = document.createElement('div');
      codeSpan.style.cssText = 'font-weight:700; font-size:14px;';
      codeSpan.textContent = loc.fullCode;
      
      const labelSpan = document.createElement('div');
      labelSpan.style.cssText = 'font-size:10px; opacity:0.55; margin-top:2px;';
      labelSpan.textContent = `${prefix.toUpperCase()}${loc.suffix.toUpperCase()}`;
      
      btn.appendChild(codeSpan);
      btn.appendChild(labelSpan);
      locationsList.appendChild(btn);
    });
  }
}

// Go back to customer list
function backToCustomerList() {
  showCustomerListView();
  renderCustomerGroups();
}

// Select a customer/location and close modal
function selectCustomerLocation(fullCode) {
  // Update the hidden input
  const oCust = document.getElementById('oCust');
  if (oCust) {
    oCust.value = fullCode;
  }
  
  // Update the button label
  const label = document.getElementById('customer-select-label');
  if (label) {
    label.textContent = fullCode;
  }
  
  // Hide "Other" input if visible
  const oOther = document.getElementById('oOther');
  if (oOther) {
    oOther.classList.add('hidden');
  }
  
  // Trigger change handlers
  if (typeof onCustomerChange === 'function') {
    onCustomerChange('o');
  }
  if (typeof refreshStartButton === 'function') {
    refreshStartButton();
  }
  if (typeof saveAll === 'function') {
    saveAll();
  }
  
  // Close modal
  closeCustomerModal();
  
  // Show toast
  if (typeof showToast === 'function') {
    showToast(`Selected: ${fullCode}`);
  }
  
  // Focus units input and open numeric keyboard
  setTimeout(() => {
    const unitsInput = document.getElementById('oTotal');
    if (unitsInput) {
      unitsInput.focus();
      // Force numeric keyboard on mobile devices
      unitsInput.click();
    }
  }, 150);
}

// Show add customer form
function showAddCustomerForm() {
  const groupsContainer = document.getElementById('customer-groups');
  const locationsContainer = document.getElementById('customer-locations');
  const addForm = document.getElementById('add-customer-form');
  const footer = document.querySelector('.modal-footer');
  
  if (groupsContainer) groupsContainer.style.display = 'none';
  if (locationsContainer) locationsContainer.style.display = 'none';
  if (addForm) addForm.style.display = 'block';
  if (footer) footer.style.display = 'none';
  
  // Clear form
  const codeInput = document.getElementById('new-customer-code');
  if (codeInput) codeInput.value = '';
  
  // Focus code input
  setTimeout(() => {
    if (codeInput) codeInput.focus();
  }, 100);
}

// Cancel add customer
function cancelAddCustomer() {
  showCustomerListView();
  renderCustomerGroups();
}

// Save new customer
function saveNewCustomer() {
  const codeInput = document.getElementById('new-customer-code');
  
  if (!codeInput) return;
  
  const code = codeInput.value.trim().toUpperCase();
  
  // Validation
  if (code.length !== 6 || !/^[A-Z]{6}$/.test(code)) {
    alert('Code must be exactly 6 letters (A-Z)');
    codeInput.focus();
    return;
  }
  
  // Check if code already exists
  if (!customCodes) customCodes = [];
  if (customCodes.indexOf(code) !== -1) {
    alert('This code already exists');
    codeInput.focus();
    return;
  }
  
  // Add code to customCodes
  customCodes.push(code);
  
  // Save and reload
  if (typeof saveCustomCodes === 'function') {
    saveCustomCodes();
  }
  if (typeof reloadDropdowns === 'function') {
    reloadDropdowns();
  }
  
  // Rebuild map and go back to customer list
  buildCustomerLocationMap();
  showCustomerListView();
  renderCustomerGroups();
  
  // Show toast
  if (typeof showToast === 'function') {
    showToast(`Added ${code}`);
  }
}

// ====== Event Listeners ======

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  // Close button
  const closeBtn = document.getElementById('customer-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeCustomerModal);
  }
  
  // Backdrop click to close
  const modal = document.getElementById('customerSelectorModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeCustomerModal();
      }
    });
  }
  
  // Back to customers button
  const backBtn = document.getElementById('back-to-customers');
  if (backBtn) {
    backBtn.addEventListener('click', backToCustomerList);
  }
  
  // Add customer button
  const addBtn = document.getElementById('add-customer-btn');
  if (addBtn) {
    addBtn.addEventListener('click', showAddCustomerForm);
  }
  
  // Cancel add customer button
  const cancelBtn = document.getElementById('cancel-add-customer');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelAddCustomer);
  }
  
  // Save new customer button
  const saveBtn = document.getElementById('save-new-customer');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveNewCustomer);
  }
  
  // Customer select trigger button
  const trigger = document.getElementById('customer-select-trigger');
  if (trigger) {
    trigger.addEventListener('click', openCustomerModal);
  }
  
  // Auto-uppercase new customer code input
  const newCodeInput = document.getElementById('new-customer-code');
  if (newCodeInput) {
    newCodeInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
    });
  }
  
  // Auto-open numeric keyboard on Units field focus
  const oTotal = document.getElementById('oTotal');
  if (oTotal) {
    oTotal.addEventListener('focus', () => {
      // Ensure numeric keyboard appears on mobile
      oTotal.setAttribute('inputmode', 'numeric');
    });
    
    // Auto-advance to Loc field when Units value entered and user presses Enter or Tab
    oTotal.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === 'Tab') && oTotal.value) {
        e.preventDefault();
        const oLoc = document.getElementById('order-locations');
        if (oLoc) {
          setTimeout(() => {
            oLoc.focus();
            oLoc.click(); // Trigger numeric keyboard
          }, 50);
        }
      }
    });
  }
  
  // Auto-open numeric keyboard on Loc field focus and auto-skip on 0
  const oLoc = document.getElementById('order-locations');
  if (oLoc) {
    oLoc.addEventListener('focus', () => {
      // Ensure numeric keyboard appears on mobile
      oLoc.setAttribute('inputmode', 'numeric');
    });
    
    // Auto-skip when user enters 0
    oLoc.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val === '0') {
        // Clear the 0 and move to next field (Start button)
        e.target.value = '';
        e.target.blur();
        // Focus Start button or trigger startOrder if enabled
        setTimeout(() => {
          const startBtn = document.getElementById('btnStart');
          if (startBtn && !startBtn.disabled) {
            startBtn.focus();
          }
        }, 50);
      }
    });
  }
});
