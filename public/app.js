window.API_URL = window.API_URL || '/api';

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('adminToken');

    // 1. LOGOUT HANDLER
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('adminToken');
            window.location.href = 'admin-login.html';
        });
    }

    // 2. VIRTUAL HARDWARE SIMULATOR HANDLERS
    const btnSimNormal = document.getElementById('btnSimNormal');
    const btnSimDuress = document.getElementById('btnSimDuress');

    if (btnSimNormal) {
        btnSimNormal.addEventListener('click', () => handleKioskScan(false));
    }

    if (btnSimDuress) {
        btnSimDuress.addEventListener('click', () => handleKioskScan(true));
    }

async function handleKioskScan(isDuress) {
        const queryInput = document.getElementById('simUserQuery');
        const movementSelect = document.getElementById('simMovementType');
        const liveStatusBox = document.getElementById('liveStatusBox');

        if (!queryInput || !queryInput.value.trim()) {
            alert('Please enter an Employee Code or Slot ID');
            return;
        }

        const inputVal = queryInput.value.trim();
        const isNumeric = /^\d+$/.test(inputVal);
        const movement = movementSelect ? movementSelect.value : 'ENTRY';

        const payload = isNumeric 
            ? { fingerprint_slot_id: parseInt(inputVal), event_type: movement }
            : { employee_code: inputVal, event_type: movement };

        const endpoint = isDuress ? `${API_URL}/events/duress` : `${API_URL}/events/access`;

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok && data.success) {
                const displayType = isDuress ? 'DURESS_OPEN' : movement;
                
                // Extract name and code from backend response if available, fallback to inputVal
                const userName = data.user && data.user.full_name ? data.user.full_name : `User / Slot: ${inputVal}`;
                const userCode = data.user && data.user.employee_code ? `(${data.user.employee_code})` : '';

                showKioskPopup(userName, userCode, displayType, data.message);

                if (liveStatusBox) {
                    liveStatusBox.style.background = isDuress ? '#f8d7da' : (movement === 'EXIT' ? '#ffe8d6' : '#d4edda');
                    liveStatusBox.innerHTML = `
                        <p style="font-size: 1.1em; margin: 0; color: ${isDuress ? '#721c24' : (movement === 'EXIT' ? '#8a4b08' : '#155724')}">
                            <strong>Status:</strong> ${isDuress ? '🚨 Duress Alert' : (movement === 'EXIT' ? '🚪 Exit' : '✅ Verified')}: <strong>${userName}</strong> ${userCode}
                        </p>
                    `;
                }
            } else {
                if (liveStatusBox) {
                    liveStatusBox.style.background = '#f8d7da';
                    liveStatusBox.innerHTML = `
                        <p style="font-size: 1.1em; color: #721c24; margin: 0;">
                            <strong>Status:</strong> ${data.error || data.message || 'Access Denied'}
                        </p>
                    `;
                }
            }
        } catch (err) {
            console.error('Simulator scan error:', err);
            if (liveStatusBox) {
                liveStatusBox.style.background = '#f8d7da';
                liveStatusBox.innerHTML = `
                    <p style="font-size: 1.1em; color: red; margin: 0;">
                        <strong>Status:</strong> Server connection failed
                    </p>
                `;
            }
        }
    }

    function showKioskPopup(nameText, codeText, eventType, message) {
        const overlay = document.getElementById('kioskOverlay');
        const title = document.getElementById('kioskTitle');
        const name = document.getElementById('kioskName');
        const dept = document.getElementById('kioskDept');

        if (!overlay) return;

        if (eventType === 'DURESS_OPEN') {
            title.innerText = '🚨 SILENT DURESS TRIGGERED';
            title.style.color = '#c0392b';
        } else if (eventType === 'EXIT') {
            title.innerText = '🚪 EXIT GRANTED';
            title.style.color = '#e67e22';
        } else {
            title.innerText = '🟢 ACCESS GRANTED';
            title.style.color = '#27ae60';
        }

        name.innerText = `${nameText} ${codeText}`;
        dept.innerText = message;

        overlay.style.display = 'flex';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 5000);
    }

const userRoleSelect = document.getElementById('userRole');
const adminSecuritySection = document.getElementById('adminSecuritySection');
const adminPasswordInput = document.getElementById('adminPasswordInput');

if (userRoleSelect && adminSecuritySection) {
    userRoleSelect.addEventListener('change', function() {
        // Matches lowercase 'admin' from your HTML option value
        if (this.value === 'admin') {
            adminSecuritySection.style.display = 'block';
            if (adminPasswordInput) adminPasswordInput.required = true;
        } else {
            adminSecuritySection.style.display = 'none';
            if (adminPasswordInput) {
                adminPasswordInput.required = false;
                adminPasswordInput.value = '';
            }
        }
    });
}

    // 4. HANDLE NEW PERSONNEL REGISTRATION & FINGERPRINT SLOT ENROLLMENT
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = localStorage.getItem('adminToken');

            const payload = {
                full_name: document.getElementById('fullName').value.trim(),
                id_number: document.getElementById('idNumber').value.trim(),
                employee_code: document.getElementById('empCode').value.trim(),
                contact_number: document.getElementById('contactNumber').value.trim(),
                email: document.getElementById('email').value.trim(),
                department: document.getElementById('department').value.trim(),
                fingerprint_slot_id: parseInt(document.getElementById('fingerprintSlotId').value),
                duress_slot_id: null,
                exit_slot_id: null
            };

            try {
                const res = await fetch(`${API_URL}/users`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();

                if (res.ok) {
                    alert(`Personnel registered successfully! Initializing hardware enrollment for Slot #${payload.fingerprint_slot_id}.`);
                    
                    await triggerHardwareEnrollment(payload.fingerprint_slot_id);

                    registerForm.reset();
                    if (passwordGroup) passwordGroup.style.display = 'none';
                    fetchUsers();
                } else {
                    alert(data.error || data.message || 'Failed to register personnel.');
                }
            } catch (err) {
                console.error('Registration error:', err);
                alert('Server connection failed during registration.');
            }
        });
    }

    // 5. FETCH & RENDER PERSONNEL TABLE
    async function fetchUsers() {
        const tbody = document.getElementById('usersTable');
        const countBadge = document.getElementById('totalPersonnelCount');
        if (!tbody) return;

        try {
            const res = await fetch(`${API_URL}/users`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const responseText = await res.text();
            
            if (!res.ok) {
                console.error(`Server Error [Status ${res.status}]:`, responseText);
                throw new Error(`Server returned status ${res.status}`);
            }

            const users = JSON.parse(responseText);

            if (Array.isArray(users) && users.length > 0) {
                if (countBadge) countBadge.innerText = users.length;

                tbody.innerHTML = users.map((user, index) => `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 12px;"><strong>#${index + 1}</strong></td>
                        <td style="padding: 12px;">${escapeHtml(user.full_name)}</td>
                        <td style="padding: 12px;">${escapeHtml(user.id_number || 'N/A')}</td>
                        <td style="padding: 12px;">${escapeHtml(user.employee_code)}</td>
                        <td style="padding: 12px;">${escapeHtml(user.contact_number || 'N/A')}</td>
                        <td style="padding: 12px;">${escapeHtml(user.email || 'N/A')}</td>
                        <td style="padding: 12px;">${escapeHtml(user.department)}</td>
                        <td style="padding: 12px;"><span style="background: #e2e8f0; color: #0f172a; padding: 3px 8px; border-radius: 4px; font-weight: bold;">Slot #${user.fingerprint_slot_id || 'N/A'}</span></td>
                        <td style="padding: 12px;">${user.created_at ? new Date(user.created_at).toISOString().split('T')[0] : 'N/A'}</td>
                        <td style="padding: 12px;">
                        <button class="btn-edit-user" 
                                data-id="${user.id}"
                                data-name="${escapeHtml(user.full_name)}"
                                data-id-number="${escapeHtml(user.id_number || '')}"
                                data-emp-code="${escapeHtml(user.employee_code)}"
                                data-contact="${escapeHtml(user.contact_number || '')}"
                                data-email="${escapeHtml(user.email || '')}"
                                data-dept="${escapeHtml(user.department)}"
                                style="background-color: #2ecc71; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-bottom: 4px;">Edit</button>
                            <button class="btn-delete-user" 
                                data-id="${user.id}"
                                data-name="${escapeHtml(user.full_name)}"
                                style="background-color: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Delete</button>
                        </td>
                    </tr>
                `).join('');
            } else {
                if (countBadge) countBadge.innerText = '0';
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 20px;">No registered employees found.</td></tr>';
            }
        } catch (err) {
            console.error('Fetch Users Error:', err);
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:red; padding: 20px;">Failed to load records. Check console for details.</td></tr>';
        }
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    if (document.getElementById('usersTable')) {
        fetchUsers();
    }

// 6. EDIT & DELETE EVENT DELEGATION (SAFE & BULLETPROOF)
    const usersTableContainer = document.getElementById('usersTable');
    if (usersTableContainer) {
        usersTableContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-edit-user');
            if (btn) {
                const setVal = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.value = val;
                };

                setVal('editUserId', btn.dataset.id || '');
                setVal('editFullName', btn.dataset.name || '');
                setVal('editIdNumber', btn.dataset.idNumber || '');
                setVal('editEmployeeCode', btn.dataset.empCode || '');
                setVal('editContactNumber', btn.dataset.contact || '');
                setVal('editEmail', btn.dataset.email || '');
                setVal('editDepartment', btn.dataset.dept || '');

                const editModal = document.getElementById('editModal');
                if (editModal) editModal.style.display = 'flex';
            }

            const deleteBtn = e.target.closest('.btn-delete-user');
            if (deleteBtn) {
                deleteUser(deleteBtn.dataset.id, deleteBtn.dataset.name);
            }
        });
    }

    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const userId = document.getElementById('editUserId').value;
            const token = localStorage.getItem('adminToken');

            const payload = {
                full_name: document.getElementById('editFullName').value,
                id_number: document.getElementById('editIdNumber').value,
                employee_code: document.getElementById('editEmployeeCode').value,
                contact_number: document.getElementById('editContactNumber').value,
                email: document.getElementById('editEmail').value,
                department: document.getElementById('editDepartment').value
            };

            try {
                const res = await fetch(`${API_URL}/users/${userId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (res.ok) {
                    closeEditModal();
                    fetchUsers();
                } else {
                    alert(data.error || 'Failed to update user details.');
                }
            } catch (err) {
                console.error('Update error:', err);
                alert('Server connection failed.');
            }
        });
    }
});

function closeEditModal() {
    const editModal = document.getElementById('editModal');
    if (editModal) editModal.style.display = 'none';
}

async function deleteUser(userId, userName) {
    if (!confirm(`Are you sure you want to delete ${userName}?`)) return;

    const token = localStorage.getItem('adminToken');
    try {
        const res = await fetch(`${API_URL}/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            window.location.reload();
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to delete user.');
        }
    } catch (err) {
        console.error('Delete error:', err);
        alert('Server connection failed.');
    }
}

// Helper function to bridge the web dashboard and hardware enrollment endpoint
async function triggerHardwareEnrollment(slotId) {
    const token = localStorage.getItem('adminToken');
    try {
        const response = await fetch(`${API_URL}/access/enroll-slot`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ slot_id: slotId })
        });
        
        const data = await response.json();
        if (!response.ok) {
            console.error('Hardware enrollment trigger failed:', data.error || data.message);
        } else {
            console.log('Hardware enrollment response:', data.message);
        }
    } catch (err) {
        console.error('Could not reach server to trigger hardware enrollment:', err);
    }
}

// 7. DOWNLOAD USERS CSV HANDLER
async function downloadUsersCSV() {
    try {
        const token = localStorage.getItem('adminToken');
        
        const response = await fetch(`${API_URL}/users/export/csv`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to download users CSV.');
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `registered_users_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
        console.error('Download error:', error);
        alert(error.message);
    }
}

// 8. DOWNLOAD DAILY ATTENDANCE PDF HANDLER
async function downloadDailyAttendancePDF() {
    try {
        const token = localStorage.getItem('adminToken');
        
        const dateInput = document.getElementById('attendanceDate');
        const selectedDate = (dateInput && dateInput.value) 
            ? dateInput.value 
            : new Date().toISOString().slice(0, 10);

        const response = await fetch(`${API_URL}/events/export/pdf?date=${selectedDate}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || errData.message || 'Failed to generate attendance PDF.');
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `attendance_log_${selectedDate}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
        console.error('PDF Download Error:', error);
        alert(`Download Error: ${error.message}`);
    }
}