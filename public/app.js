const API_URL = '/api';

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
                showKioskPopup(inputVal, displayType, data.message);

                if (liveStatusBox) {
                    liveStatusBox.style.background = isDuress ? '#f8d7da' : (movement === 'EXIT' ? '#ffe8d6' : '#d4edda');
                    liveStatusBox.innerHTML = `
                        <p style="font-size: 1.1em; margin: 0; color: ${isDuress ? '#721c24' : (movement === 'EXIT' ? '#8a4b08' : '#155724')}">
                            <strong>Status:</strong> ${data.message}
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

    function showKioskPopup(identifier, eventType, message) {
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

        name.innerText = `User / Slot: ${identifier}`;
        dept.innerText = message;

        overlay.style.display = 'flex';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 5000);
    }

    // 3. FETCH & RENDER PERSONNEL TABLE
    async function fetchUsers() {
        const tbody = document.getElementById('usersTable');
        const countBadge = document.getElementById('totalPersonnelCount');
        if (!tbody) return;

        try {
            const res = await fetch(`${API_URL}/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.status === 401 || res.status === 403) {
                localStorage.removeItem('adminToken');
                window.location.href = 'admin-login.html';
                return;
            }

            const users = await res.json();

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
                        <td style="padding: 12px;">${user.created_at ? new Date(user.created_at).toISOString().split('T')[0] : 'N/A'}</td>
                        <td style="padding: 12px;">
                            <button class="btn-edit-user" 
                                data-id="${user.id}"
                                data-name="${escapeHtml(user.full_name)}"
                                data-idnumber="${escapeHtml(user.id_number || '')}"
                                data-empcode="${escapeHtml(user.employee_code)}"
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
                tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 20px;">No registered employees found.</td></tr>';
            }
        } catch (err) {
            console.error('Error fetching users:', err);
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:red; padding: 20px;">Failed to load records.</td></tr>';
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
});