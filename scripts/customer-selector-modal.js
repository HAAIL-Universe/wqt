// ====== Customer Selector Modal Functions ======

// Customer/location data structure
let customerLocationMap = {};

// Build the map from existing codes
function buildCustomerLocationMap() {
  const allCodes = Array.from(new Set([...(DEFAULT_CODES || []), ...(customCodes || [])]));
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
  
  // Sort locations within each customer
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
  
  // Clear and focus search
  const searchInput = document.getElementById('customer-search');
  if (searchInput) {
    searchInput.value = '';
    setTimeout(() => searchInput.focus(), 100);
  }
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
  
  // Get search term
  const searchInput = document.getElementById('customer-search');
  const searchTerm = (searchInput?.value || '').toLowerCase();
  
  // Get sorted customer prefixes
  const sortedPrefixes = Object.keys(customerLocationMap).sort();
  
  let hasResults = false;
  
  sortedPrefixes.forEach(prefix => {
    // Filter by search
    if (searchTerm && !prefix.toLowerCase().includes(searchTerm)) {
      return;
    }
    
    hasResults = true;
    
    const locations = customerLocationMap[prefix];
    
    // Create group
    const groupDiv = document.createElement('div');
    groupDiv.className = 'customer-group';
    
    // Group header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'customer-group-header';
    headerDiv.textContent = prefix.toUpperCase();
    
    // Group items
    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'customer-group-items';
    
    // Single item to click (shows locations for this prefix)
    const itemDiv = document.createElement('div');
    itemDiv.className = 'customer-item';
    itemDiv.onclick = () => showLocationSelection(prefix);
    
    const prefixSpan = document.createElement('span');
    prefixSpan.className = 'customer-item-prefix';
    prefixSpan.textContent = prefix.toUpperCase();
    
    const countSpan = document.createElement('span');
    countSpan.className = 'customer-item-count';
    countSpan.textContent = `${locations.length} location${locations.length !== 1 ? 's' : ''}`;
    
    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'customer-item-arrow';
    arrowSpan.textContent = '→';
    
    const leftDiv = document.createElement('div');
    leftDiv.appendChild(prefixSpan);
    leftDiv.appendChild(countSpan);
    
    itemDiv.appendChild(leftDiv);
    itemDiv.appendChild(arrowSpan);
    
    itemsDiv.appendChild(itemDiv);
    groupDiv.appendChild(headerDiv);
    groupDiv.appendChild(itemsDiv);
    container.appendChild(groupDiv);
  });
  
  // Show "no results" if needed
  if (!hasResults) {
    const noResults = document.createElement('div');
    noResults.className = 'hint';
    noResults.style.textAlign = 'center';
    noResults.style.padding = '20px';
    noResults.textContent = searchTerm ? 'No customers found' : 'No customers available';
    container.appendChild(noResults);
  }
}

// Show locations for a customer prefix
function showLocationSelection(prefix) {
  const locations = customerLocationMap[prefix];
  if (!locations) return;
  
  const groupsContainer = document.getElementById('customer-groups');
  const locationsContainer = document.getElementById('customer-locations');
  const locationsList = document.getElementById('locations-list');
  const customerNameEl = document.getElementById('location-customer-name');
  const footer = document.querySelector('.modal-footer');
  
  // Hide groups, show locations
  if (groupsContainer) groupsContainer.style.display = 'none';
  if (locationsContainer) locationsContainer.style.display = 'flex';
  if (footer) footer.style.display = 'none';
  
  // Set header
  if (customerNameEl) {
    customerNameEl.textContent = `${prefix.toUpperCase()} – Select Location`;
  }
  
  // Render locations
  if (locationsList) {
    locationsList.innerHTML = '';
    
    locations.forEach(loc => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'location-item';
      itemDiv.onclick = () => selectCustomerLocation(loc.fullCode);
      
      const codeDiv = document.createElement('div');
      codeDiv.className = 'location-item-code';
      codeDiv.textContent = loc.fullCode;
      
      const labelDiv = document.createElement('div');
      labelDiv.className = 'location-item-label';
      labelDiv.textContent = `${prefix.toUpperCase()} - ${loc.suffix.toUpperCase()}`;
      
      itemDiv.appendChild(codeDiv);
      itemDiv.appendChild(labelDiv);
      locationsList.appendChild(itemDiv);
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
  
  // Focus units input
  setTimeout(() => {
    const unitsInput = document.getElementById('oTotal');
    if (unitsInput) unitsInput.focus();
  }, 100);
}

// Filter customers based on search
function filterCustomers() {
  renderCustomerGroups();
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
  const nameInput = document.getElementById('new-customer-name');
  const prefixInput = document.getElementById('new-customer-prefix');
  if (nameInput) nameInput.value = '';
  if (prefixInput) prefixInput.value = '';
  
  // Reset to one location input
  const locContainer = document.getElementById('new-customer-locations-list');
  if (locContainer) {
    locContainer.innerHTML = `
      <div class="location-input-row">
        <input type="text" class="location-suffix-input" maxlength="3" placeholder="e.g. WES" style="text-transform:uppercase;" />
        <input type="text" class="location-name-input" placeholder="Location name (optional)" />
      </div>
    `;
  }
  
  // Focus name input
  setTimeout(() => {
    if (nameInput) nameInput.focus();
  }, 100);
}

// Cancel add customer
function cancelAddCustomer() {
  showCustomerListView();
  renderCustomerGroups();
}

// Add another location input row
function addLocationRow() {
  const container = document.getElementById('new-customer-locations-list');
  if (!container) return;
  
  const row = document.createElement('div');
  row.className = 'location-input-row';
  row.innerHTML = `
    <input type="text" class="location-suffix-input" maxlength="3" placeholder="e.g. WES" style="text-transform:uppercase;" />
    <input type="text" class="location-name-input" placeholder="Location name (optional)" />
    <button class="btn ghost slim" type="button" onclick="this.parentElement.remove()">✖</button>
  `;
  container.appendChild(row);
}

// Save new customer
function saveNewCustomer() {
  const nameInput = document.getElementById('new-customer-name');
  const prefixInput = document.getElementById('new-customer-prefix');
  
  if (!nameInput || !prefixInput) return;
  
  const customerName = nameInput.value.trim();
  const prefix = prefixInput.value.trim().toUpperCase();
  
  // Validation
  if (!customerName) {
    alert('Please enter a customer name');
    nameInput.focus();
    return;
  }
  
  if (prefix.length !== 3 || !/^[A-Z]{3}$/.test(prefix)) {
    alert('Prefix must be exactly 3 letters');
    prefixInput.focus();
    return;
  }
  
  // Get all location suffixes
  const locationRows = document.querySelectorAll('#new-customer-locations-list .location-input-row');
  const suffixes = [];
  
  locationRows.forEach(row => {
    const suffixInput = row.querySelector('.location-suffix-input');
    const suffix = (suffixInput?.value || '').trim().toUpperCase();
    
    if (suffix.length === 3 && /^[A-Z]{3}$/.test(suffix)) {
      suffixes.push(suffix);
    }
  });
  
  if (suffixes.length === 0) {
    alert('Please add at least one valid location (3 letters)');
    return;
  }
  
  // Add new codes to customCodes
  const newCodes = [];
  suffixes.forEach(suffix => {
    const fullCode = prefix + suffix;
    if (!customCodes) customCodes = [];
    if (customCodes.indexOf(fullCode) === -1) {
      customCodes.push(fullCode);
      newCodes.push(fullCode);
    }
  });
  
  if (newCodes.length > 0) {
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
      showToast(`Added ${customerName} with ${newCodes.length} location(s)`);
    }
  } else {
    alert('All locations already exist');
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
  
  // Search input
  const searchInput = document.getElementById('customer-search');
  if (searchInput) {
    searchInput.addEventListener('input', filterCustomers);
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
  
  // Add location row button
  const addLocBtn = document.getElementById('add-location-row');
  if (addLocBtn) {
    addLocBtn.addEventListener('click', addLocationRow);
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
  
  // Auto-uppercase prefix input
  const prefixInput = document.getElementById('new-customer-prefix');
  if (prefixInput) {
    prefixInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    });
  }
  
  // Auto-uppercase location suffix inputs (delegated)
  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('location-suffix-input')) {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    }
  });
});
