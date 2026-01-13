/**
 * GOELink Application Entry Point
 */

const App = {
    // Core State
    state: {
        user: null, // Auth User Object
        role: null, // 'admin' | 'teacher'
        status: null, // 'active' | 'pending'
        currentYear: new Date().getFullYear(),
        viewMode: 'calendar', // 'calendar', 'list'
        departments: [], // Cached Departments
    },

    // Constants
    SPECIAL_DEPTS: [
        { id: 'admin_office', name: '행정실' },
        { id: 'advanced_teacher', name: '수석' },
        { id: 'vice_principal', name: '교감' },
        { id: 'principal', name: '교장' },
    ],

    FIXED_ENV_EVENTS: {
        "02-02": "세계 습지의 날",
        "03-22": "세계 물의 날",
        "04-05": "식목일",
        "04-22": "지구의 날",
        "05-22": "생물종다양성 보존의 날",
        "06-05": "환경의 날",
        "08-22": "에너지의 날",
        "09-06": "자원순환의 날",
        "09-16": "세계 오존층 보호의 날",
    },

    // Initialization
    init: async function () {
        console.log("GOELink Initializing...");

        try {
            // 1. Initialize Supabase
            if (window.SupabaseClient) {
                await window.SupabaseClient.init();
            } else {
                throw new Error("Supabase Client not loaded.");
            }

            // 2. Check Auth State
            await this.checkAuth();

            // 3. Routing & History Setup
            window.addEventListener('popstate', (event) => {
                // Handle Back/Forward Button
                const viewName = event.state?.view || 'calendar';
                // Update internal state directly to avoid recursion or double-pushing
                this.state.viewMode = viewName;
                localStorage.setItem('pogok_last_view', viewName);
                this.loadView(viewName);
            });

            // 4. Load Initial View
            const savedView = localStorage.getItem('pogok_last_view') || 'calendar';
            let initialView = savedView;

            if (window.location.hash) {
                const hashView = window.location.hash.substring(1);
                if (['calendar', 'login', 'admin'].includes(hashView)) {
                    initialView = hashView;
                }
            }

            // Replace current state (initial load)
            history.replaceState({ view: initialView }, '', '#' + initialView);
            this.navigate(initialView, true); // true = replace (don't push again)

            console.log("GOELink Ready.");
        } catch (error) {
            console.error("Initialization Failed:", error);
            alert("시스템 초기화 중 오류가 발생했습니다: " + error.message);
        } finally {
            // 5. Remove Loader (Always run)
            document.getElementById('loading-spinner').classList.add('hidden');
            document.getElementById('view-container').classList.remove('hidden');
        }
    },

    navigate: function (viewName, replace = false) {
        this.state.viewMode = viewName;
        localStorage.setItem('pogok_last_view', viewName);
        
        if (replace) {
             // Already handled state via replaceState in init usually, or we just loadView
             // But if we want to force replace header:
             history.replaceState({ view: viewName }, '', '#' + viewName);
        } else {
             // Push new state
             history.pushState({ view: viewName }, '', '#' + viewName);
        }
        
        this.loadView(viewName);
    },

    checkAuth: async function () {
        try {
            const { data, error } = await window.SupabaseClient.supabase.auth.getSession();
            if (error) throw error;

            await this.syncUser(data.session?.user);
            this.updateAuthUI(data.session);
        } catch (e) {
            console.error("checkAuth: Error getting session", e);
        }

        // Listen for auth changes
        window.SupabaseClient.supabase.auth.onAuthStateChange(async (_event, session) => {
            await this.syncUser(session?.user);
            this.updateAuthUI(session);
            // Redirect to calendar if logged in from login page
            if (session && this.state.viewMode === 'login') {
                this.navigate('calendar');
            }
        });
    },

    // Sync User with DB (Upsert & Fetch Role)
    syncUser: async function (authUser) {
        if (!authUser) {
            this.state.user = null;
            this.state.role = null;
            this.state.status = null;
            return;
        }

        try {
            // 1. Sync User Info (Upsert)
            // We lazily create the user_role entry on login if it doesn't exist
            const { error: upsertError } = await window.SupabaseClient.supabase
                .from('user_roles')
                .upsert({
                    user_id: authUser.id,
                    email: authUser.email,
                    last_login: new Date().toISOString()
                }, { onConflict: 'user_id' });

            if (upsertError) {
                console.warn("User Synced failed (Table might not exist yet?):", upsertError);
            }

            // 2. Fetch Role Info
            const { data, error: fetchError } = await window.SupabaseClient.supabase
                .from('user_roles')
                .select('role, status')
                .eq('user_id', authUser.id)
                .single();

            this.state.user = authUser;

            if (data) {
                this.state.role = data.role;
                this.state.status = data.status;
            } else {
                // Default fallback if fetch failed or just inserted
                this.state.role = 'teacher';
                this.state.status = 'pending';
            }

            console.log(`User: ${authUser.email}, Role: ${this.state.role}, Status: ${this.state.status}`);

        } catch (e) {
            console.error("Sync Logic Error:", e);
            // Fallback
            this.state.user = authUser;
            this.state.role = 'teacher';
        }
    },

    updateAuthUI: function (session) {
        // State is already updated by syncUser, but we ensure consistency
        if (!this.state.user && session?.user) this.state.user = session.user;

        const authContainer = document.getElementById('auth-status');

        if (!authContainer) {
            console.error("updateAuthUI: 'auth-status' element not found!");
            return;
        }

        if (this.state.user) {
            const userEmail = this.state.user.email.split('@')[0];
            const adminBtn = this.state.role === 'admin'
                ? `<button id="btn-admin" class="text-sm px-3 py-1 border border-purple-200 text-purple-700 rounded bg-purple-50 hover:bg-purple-100 ml-2">관리자</button>`
                : '';

            authContainer.innerHTML = `
                <span class="text-sm text-gray-700 hidden sm:inline">안녕하세요, <strong>${userEmail}</strong>님</span>
                ${adminBtn}
                <button id="btn-logout" class="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 ml-2">로그아웃</button>
            `;

            document.getElementById('btn-logout').addEventListener('click', async () => {
                await window.SupabaseClient.supabase.auth.signOut();
                this.navigate('calendar');
                window.location.reload(); // Clean state
            });

            if (this.state.role === 'admin') {
                document.getElementById('btn-admin').addEventListener('click', () => {
                    this.navigate('admin');
                });
            }
        } else {
            authContainer.innerHTML = `
                <button id="btn-login" class="text-sm font-medium text-gray-600 hover:text-gray-900">로그인</button>
            `;
            document.getElementById('btn-login').addEventListener('click', () => {
                this.navigate('login');
            });
        }

        // Update other UI elements based on role
        this.updateAccessControls();
    },

    updateAccessControls: function () {
        // "Add Schedule" Button Visibility
        // Visible for: Admin, Head Teacher
        // Hidden for: Teacher, Guest
        const btnAddSchedule = document.getElementById('btn-add-schedule');

        if (btnAddSchedule) {
            const canAdd = this.state.role === 'admin' || this.state.role === 'head_teacher';

            if (canAdd) {
                btnAddSchedule.classList.remove('hidden');
            } else {
                btnAddSchedule.classList.add('hidden');
            }
        }
    },

    loadView: async function (viewName) {
        const container = document.getElementById('view-container');

        // Cleanup content
        container.innerHTML = '';

        if (viewName === 'calendar') {
            try {
                const response = await fetch('pages/calendar.html');
                const html = await response.text();
                container.innerHTML = html;
                this.initCalendar();
            } catch (e) {
                console.error("Failed to load calendar", e);
                container.innerHTML = `<p class="text-red-500">캘린더 로딩 실패</p>`;
            }
        } else if (viewName === 'login') {
            try {
                const response = await fetch('pages/login.html');
                const html = await response.text();
                container.innerHTML = html;
                this.initLoginView();
            } catch (e) {
                console.error("Failed to load login page", e);
                container.innerHTML = "<p class='text-red-500'>페이지를 불러올 수 없습니다.</p>";
            }
        } else if (viewName === 'admin') {
            // Check Admin Auth (Simple client-side check, real security via RLS)
            if (!this.state.user || this.state.role !== 'admin') {
                alert("접근 권한이 없습니다.");
                this.navigate('calendar'); // Redirect to calendar instead of login if already logged in but not admin
                return;
            }

            try {
                const response = await fetch('pages/admin.html');
                const html = await response.text();
                container.innerHTML = html;
                this.initAdminView();
            } catch (e) {
                console.error("Failed to load admin page", e);
                container.innerHTML = "<p class='text-red-500'>페이지를 불러올 수 없습니다.</p>";
            }
        }

        // Re-run Auth UI update to bind header buttons if they exist
        // This is crucial because header buttons might be part of the layout, 
        // but if we have view-specific buttons (like in login page), they need specific init.
        // Actually, header is static. But `btn-login` might be in header.

        // Safety check: ensure header auth UI is consistent
        this.updateAuthUI(this.state.user ? { user: this.state.user } : null);
    },

    initLoginView: function () {
        const form = document.getElementById('login-form');
        const errorMsg = document.getElementById('login-error');
        const DOMAIN = 'pogok.hs.kr'; // Default domain for short IDs

        form.onsubmit = async (e) => {
            e.preventDefault();
            let email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const btn = document.getElementById('btn-login-submit');

            // Auto-append domain if not present
            if (!email.includes('@')) {
                email = `${email}@${DOMAIN}`;
            }

            btn.disabled = true;
            btn.innerHTML = '로그인 중...';
            errorMsg.classList.add('hidden');

            try {
                const { data, error } = await window.SupabaseClient.supabase.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;
                // Auth State Change listener will handle redirect
            } catch (err) {
                errorMsg.textContent = '로그인 실패: 이메일 또는 비밀번호를 확인하세요.';
                errorMsg.classList.remove('hidden');
                btn.disabled = false;
                btn.innerHTML = '로그인';
            }
        };

        document.getElementById('btn-signup').onclick = () => {
            alert('초기 가입은 관리자가 생성해준 계정을 사용하거나, 별도 가입 페이지를 이용해야 합니다.');
        };
    },

        initAdminView: async function () {
        // 0. Ensure Settings/Departments Loaded for target year
        const yearSelect = document.getElementById('setting-academic-year');
        
        // Dynamic Year Dropdown Generation
        if (yearSelect) {
            const currentYear = new Date().getFullYear();
            const startYear = currentYear - 5;
            const endYear = currentYear + 5;
            yearSelect.innerHTML = '';
            for (let y = startYear; y <= endYear; y++) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = `${y}학년도`;
                if (y === currentYear) opt.selected = true;
                yearSelect.appendChild(opt);
            }
        }

        const currentSelectedYear = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
        
        const settings = await this.fetchSettings(currentSelectedYear);
        this.state.departments = await this.fetchDepartments();

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if(el) {
                // If the field is currently in manual mode, don't overwrite
                if (el.dataset.manual === 'true') return;

                el.value = val;
                // Dispatch event so cascading formulas trigger
                el.dispatchEvent(new Event('change'));
            }
        };

        const formatDate = (date) => {
            if (!date || isNaN(date.getTime())) return '';
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        const addDays = (dateStr, days) => {
            if(!dateStr) return '';
            if(dateStr.length < 10) return '';
            const d = new Date(dateStr);
            if(isNaN(d.getTime())) return '';
            d.setDate(d.getDate() + days);
            return formatDate(d);
        };

        const triggerYearSmartCalc = (year) => {
            if(!year) return;
            
            // Collect Variable Holidays from UI for immediate calculation
            const holidayDates = [];
            document.querySelectorAll('.holiday-date').forEach(inp => {
                if (inp.value) holidayDates.push(inp.value);
            });

            // 1. 1st Semester Start: First weekday of March
            // March 1st is fixed holiday (Sam-il-jeol)
            let d = new Date(year, 2, 1); 
            d.setDate(2); // Start searching from March 2nd
            
            const isNonSchoolDay = (dateObj) => {
                const day = dateObj.getDay();
                if (day === 0 || day === 6) return true; // Weekend
                const dateStr = formatDate(dateObj);
                const mmdd = dateStr.split('-').slice(1).join('');
                if (this.currentFixedHolidays && this.currentFixedHolidays[mmdd]) return true; // Fixed holiday
                if (holidayDates.includes(dateStr)) return true; // Variable/Manual holiday
                return false;
            };

            while(isNonSchoolDay(d)) {
                d.setDate(d.getDate() + 1);
            }
            setVal('sched-sem1-start', formatDate(d));

            // 2. Winter Vacation End: Last day of February of the NEXT year
            const febYear = parseInt(year) + 1;
            let lastFeb = new Date(febYear, 2, 0); 
            setVal('sched-winter-end', formatDate(lastFeb));
        };

        this.triggerSmartCalc = () => {
            const y = yearSelect ? yearSelect.value : null;
            if(y) triggerYearSmartCalc(y);
        };

        // --- Manual Override Tracker ---
        // Any manual input by the user on these fields should set the manual flag
        const schedIds = [
            'sched-sem1-start', 'sched-summer-start-ceremony', 'sched-summer-start', 
            'sched-summer-end', 'sched-sem2-start', 'sched-winter-start-ceremony', 
            'sched-winter-start', 'sched-winter-end', 'sched-spring-sem-start', 
            'sched-spring-start-ceremony', 'sched-spring-start', 'sched-spring-end'
        ];
        schedIds.forEach(id => {
            document.getElementById(id)?.addEventListener('input', (e) => {
                e.target.dataset.manual = 'true';
            });
        });

        // --- Manual Override Handler (Alert for Readonly fields) ---
        document.querySelectorAll('input[readonly][data-hint]').forEach(el => {
            el.addEventListener('click', () => {
                if (el.readOnly && el.dataset.manual !== 'true') {
                    const hintName = el.dataset.hint || "기간";
                    if (confirm(`${hintName}을(를) 입력하면 자동으로 입력됩니다. 수동 입력하시겠습니까?`)) {
                        el.readOnly = false;
                        el.dataset.manual = 'true';
                        el.classList.remove('bg-gray-100');
                        el.classList.add('bg-white');
                        el.focus();
                    }
                }
            });
        });

        // 1. Department Management (General)
        // Note: Department Rendering is handled by populateAdminForm to ensure state sync.
        // We only prepare the container and buttons here.
        const deptList = document.getElementById('admin-dept-list');
        const btnAddDeptSlot = document.getElementById('btn-add-dept-slot');
        const btnSaveDept = document.getElementById('btn-save-depts');

        if(btnAddDeptSlot) {
            btnAddDeptSlot.onclick = () => {
                const row = document.createElement('div');
                row.className = "flex items-center gap-2 mb-2";
                row.innerHTML = `
                    <input type="text" placeholder="부서명" class="dept-name-input border rounded px-2 py-1 w-48" />
                    <input type="color" value="#3788d8" class="dept-color-input border rounded h-8 w-8 cursor-pointer" />
                    <button class="btn-delete-dept text-red-500 hover:text-red-700">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                `;
                deptList.appendChild(row);
                row.querySelector('.btn-delete-dept').onclick = () => row.remove();
            };
        }

        if(btnSaveDept) {
            btnSaveDept.onclick = async () => {
                await this.handleSaveSettings(); // Department config is saved within settings for multi-year
            };
        }
        
        // 2. Schedule Settings Loading
        // We use loadAndPopulate to handle year switching
        const loadAndPopulate = async (y = null) => {
             const settings = await this.fetchSettings(y);
             const isNewYear = !settings || !settings.id; // Detect new by missing ID

             // Alert for new year (only if specifically requested via switching)
             if (y && isNewYear) {
                 alert(`${y}학년도를 처음 설정하려고 합니다.\n날짜를 검토 후, '학년도 및 기본 학사 일정 저장', '부서 설정 저장' 버튼을 눌러주세요.`);
             }

             this.populateAdminForm(settings, y);
             
             // Smart Calc for Year-based dates (Only for NEW years to avoid overwrite)
             const selectedYear = y || (yearSelect ? yearSelect.value : null);
             if(selectedYear && isNewYear) {
                 triggerYearSmartCalc(selectedYear);
             }
        };
        
        await loadAndPopulate(); // Initial load
        
        // Academic Year Change Listener
        if(yearSelect) {
            yearSelect.addEventListener('change', async (e) => {
                const newYear = parseInt(e.target.value);
                await loadAndPopulate(newYear);
            });
        }
        
        // School Level Sync (KR -> EN)
        const krLevelSelect = document.getElementById('setting-school-level-kr');
        const enLevelSelect = document.getElementById('setting-school-level-en');
        if(krLevelSelect && enLevelSelect) {
             krLevelSelect.addEventListener('change', () => {
                 const map = {
                    '초등학교': 'Elementary School',
                    '중학교': 'Middle School',
                    '고등학교': 'High School',
                    '특수학교': 'School',
                    '학교': 'School'
                 };
                 const val = map[krLevelSelect.value];
                 if(val) enLevelSelect.value = val;
             });
             enLevelSelect.addEventListener('change', () => {
                  const revMap = {
                     'Elementary School': '초등학교',
                     'Middle School': '중학교',
                     'High School': '고등학교',
                     'School': '학교'
                  };
                  const val = revMap[enLevelSelect.value];
                  if(val) krLevelSelect.value = val;
             });
        }
        // Date Cascading Listeners
        document.getElementById('sched-summer-start')?.addEventListener('change', (e) => {
            setVal('sched-summer-start-ceremony', addDays(e.target.value, -1));
        });
        document.getElementById('sched-summer-end')?.addEventListener('change', (e) => {
            setVal('sched-sem2-start', addDays(e.target.value, 1));
        });
        document.getElementById('sched-winter-start')?.addEventListener('change', (e) => {
            setVal('sched-winter-start-ceremony', addDays(e.target.value, -1));
        });
        document.getElementById('sched-winter-end')?.addEventListener('change', (e) => {
            const val = e.target.value;
            if(!val) return;
            const d = new Date(val);
            const lastFeb = new Date(d.getFullYear(), 2, 0);
            if(formatDate(d) === formatDate(lastFeb)) {
                setVal('sched-spring-sem-start', '');
            } else {
                setVal('sched-spring-sem-start', addDays(val, 1));
            }
        });
        document.getElementById('sched-spring-start')?.addEventListener('change', (e) => {
            const val = e.target.value;
            setVal('sched-spring-start-ceremony', addDays(val, -1));
            
            if(val) {
                const d = new Date(val);
                const lastFeb = new Date(d.getFullYear(), 2, 0);
                setVal('sched-spring-end', formatDate(lastFeb));
            }
        });
        
        // Variable Holidays Container
        const container = document.getElementById('variable-holidays-container');
        if(container) {
            container.addEventListener('change', (e) => {
                 if(e.target.classList.contains('holiday-date')) {
                     this.triggerSmartCalc();
                 }
            });
        }
        
        const btnAddHol = document.getElementById('btn-add-holiday');
        if(btnAddHol) {
            btnAddHol.onclick = () => {
                this.syncVariableHolidaysFromUI(); // State-sync first
                if(!this.currentVariableHolidays) this.currentVariableHolidays = [];
                this.currentVariableHolidays.push({ date: '', name: '' });
                this.renderVariableHolidays(this.currentVariableHolidays);
            };
        }
        
        // Major Events Container
        const majorContainer = document.getElementById('major-events-container');
        if(majorContainer) {
            majorContainer.addEventListener('change', (e) => {
                 if(e.target.classList.contains('event-date')) {
                     // triggerSmartCalc(); // Not needed for pure events
                 }
            });
        }

        const btnAddMajor = document.getElementById('btn-add-major-event');
        if(btnAddMajor) {
            btnAddMajor.onclick = () => {
                this.syncMajorEventsFromUI();
                if(!this.currentMajorEvents) this.currentMajorEvents = [];
                this.currentMajorEvents.push({ start: '', end: '', name: '' });
                this.renderMajorEvents(this.currentMajorEvents);
                
                // Scroll to bottom
                requestAnimationFrame(() => {
                    const container = document.getElementById('major-events-container');
                    if (container) {
                        container.scrollTop = container.scrollHeight;
                    }
                });
            };
        }
        
        // Save Settings (Main Button)
        const btnSaveSettings = document.getElementById('btn-save-settings');
        if(btnSaveSettings) {
            btnSaveSettings.onclick = async () => {
                await this.handleSaveSettings();
            };
        }

        // Save School Info (New Button)
        const btnSaveSchoolInfo = document.getElementById('btn-save-school-info');
        if(btnSaveSchoolInfo) {
            btnSaveSchoolInfo.onclick = async () => {
                await this.handleSaveSchoolInfo();
            };
        }
        
        // Load Admin Users List
        this.loadAdminUsers();
    },

    populateAdminForm: async function(settings, targetYear) {
         const data = settings || {};
         // Removed schedule_data and department_config dependency
         
         // 1. Academic Year Dropdown
         const yearSelect = document.getElementById('setting-academic-year');
         if(yearSelect) {
             const y = targetYear || data.academic_year || new Date().getFullYear();
             this.state.currentYear = y;
         }

         // --- Helper for setting values ---
         const setVal = (id, val) => {
             const el = document.getElementById(id);
             if(el) el.value = val || '';
         };

         // 2. School Info
         // Prioritize full_name_kr if column exists (even if null), otherwise fallback to school_name (legacy)
         const koName = (data.full_name_kr !== undefined) ? data.full_name_kr : data.school_name;
         setVal('setting-school-name-kr', koName || '');
         
         setVal('setting-school-name-en', data.name_en || '');
         setVal('setting-school-level-kr', data.level_kr || '');
         setVal('setting-school-level-en', data.level_en || '');

         // 3. Departments
         const deptList = document.getElementById('admin-dept-list');
         if(deptList) {
             deptList.innerHTML = '';
             
             // Filter DB departments into General vs Special
             const allDepts = this.state.departments || [];
             const specNames = this.SPECIAL_DEPTS.map(s => s.name);
             
             const genDepts = allDepts
                 .filter(d => !specNames.includes(d.dept_name))
                 .map(d => ({
                     name: d.dept_name,
                     nickname: d.dept_short,
                     color: d.dept_color
                 }));
             
             // Safe Colors
             const safeColors = ['#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#64748b', '#6366f1', '#8b5cf6', '#71717a', '#4b5563'];

             const renderRow = (d, index) => {
                 const row = document.createElement('div');
                 row.className = "flex items-center gap-2 mb-2";
                 const defaultColor = safeColors[index % safeColors.length];
                 
                 let color = d.color || defaultColor;
                 let name = d.name || '';
                 let nickname = d.nickname || '';
                 if (!nickname && name) {
                     nickname = name.substring(0, 2);
                 }

                 row.innerHTML = `
                     <input type="text" value="${name}" class="dept-name-input border rounded px-2 py-1 w-48 focus:ring-2 focus:ring-purple-200" placeholder="부서명" />
                     <input type="text" value="${nickname}" class="dept-nickname-input border rounded px-2 py-1 w-16 text-center text-sm focus:ring-2 focus:ring-purple-200" placeholder="약어" maxlength="3" />
                     <input type="color" value="${color}" class="dept-color-input border rounded h-8 w-8 cursor-pointer p-0.5 bg-white" />
                     <button class="btn-delete-dept text-gray-400 hover:text-red-500 transition-colors">
                        <span class="material-symbols-outlined text-lg">delete</span>
                     </button>
                 `;
                 deptList.appendChild(row);
                 
                 const nameInput = row.querySelector('.dept-name-input');
                 const nickInput = row.querySelector('.dept-nickname-input');
                 const delBtn = row.querySelector('.btn-delete-dept');

                 // Auto-fill nickname logic
                 nameInput.addEventListener('input', (e) => {
                     if(!nickInput.value) nickInput.value = e.target.value.substring(0, 2);
                 });
                 
                 nickInput.addEventListener('input', (e) => {
                     let val = e.target.value;
                     if (val.length === 3 && !/[0-9]/.test(val)) e.target.value = val.substring(0, 2);
                 });

                 delBtn.onclick = () => row.remove();
             };

             // Ensure at least 10 slots
             let deptsToRender = genDepts.length > 0 ? [...genDepts] : [];
             const minCount = 10;
             while(deptsToRender.length < minCount) {
                 deptsToRender.push({});
             }

             deptsToRender.forEach((d, i) => renderRow(d, i));
             
             // Bind Add Button
             const btnAdd = document.getElementById('btn-add-dept-slot');
             if (btnAdd) {
                 btnAdd.onclick = () => {
                     renderRow({}, deptList.children.length);
                 };
             }
         }

         // Special Departments (Same logic as before, just kept for completeness)
         const specList = document.getElementById('admin-special-dept-list');
         if(specList) {
             specList.innerHTML = '';
             const targetDepts = this.SPECIAL_DEPTS || [];
             const allDepts = this.state.departments || [];
             const defaultSpecColors = {
                 'admin_office': '#64748b', 'vice_principal': '#71717a', 'principal': '#4b5563', 
                 'head_teacher': '#3b82f6', 'science_head': '#0ea5e9', 'advanced_teacher': '#8b5cf6'
             };
             
             targetDepts.forEach(s => {
                 const savedRow = allDepts.find(d => d.dept_name === s.name);
                 const defColor = defaultSpecColors[s.id] || '#9ca3af';
                 const color = savedRow ? (savedRow.dept_color || defColor) : defColor;
                 const active = savedRow ? savedRow.is_active : false; 
                 let nickname = savedRow ? (savedRow.dept_short || '') : '';
                 if(!nickname) nickname = s.name.substring(0, 2);

                 const div = document.createElement('div');
                 div.className = "flex items-center gap-2 mb-2 special-dept-row";
                 div.dataset.id = s.id;
                 div.dataset.name = s.name;
                 
                 div.innerHTML = `
                     <input type="text" value="${s.name}" readonly class="bg-white text-gray-600 border rounded px-2 py-1 w-32 cursor-default focus:ring-0" />
                     <input type="text" value="${nickname}" class="special-dept-nickname border rounded px-2 py-1 w-16 text-center text-sm focus:ring-2 focus:ring-purple-200" placeholder="약어" maxlength="3" />
                     <input type="color" value="${color}" class="special-dept-color border rounded h-8 w-8 cursor-pointer p-0.5 bg-white" />
                     <label class="flex items-center gap-2 cursor-pointer text-sm select-none">
                         <input type="checkbox" class="special-dept-check rounded text-purple-600 focus:ring-purple-500" ${active ? 'checked' : ''}>
                         <span class="text-gray-600">사용</span>
                     </label>
                 `;
                 specList.appendChild(div);
                 
                 const specNick = div.querySelector('.special-dept-nickname');
                 specNick.addEventListener('input', (e) => {
                     let val = e.target.value;
                     if (val.length === 3 && !/[0-9]/.test(val)) e.target.value = val.substring(0, 2);
                 });
             });
         }

         // --- 4. Basic Schedules (Fetch from new Table) ---
         const targetY = this.state.currentYear;
         const { data: scheduleRows } = await window.SupabaseClient.supabase
             .from('basic_schedules')
             .select('*')
             .eq('academic_year', targetY);
         
         const schedules = scheduleRows || [];

         if (schedules.length === 0) {
             alert(`${targetY}학년도 학사일정 데이터가 없습니다.\n"학년도 및 기본 학사 일정 저장 버튼"을 누르면, 새 학년도가 시작됩니다.`);
         }
         
         // Clear fields first
         const clearInputs = ['sched-sem1-start', 'sched-summer-start', 'sched-summer-start-ceremony', 'sched-summer-end',
             'sched-sem2-start', 'sched-winter-start-ceremony', 'sched-winter-start', 'sched-winter-end',
             'sched-spring-start-ceremony', 'sched-spring-vac-start', 'sched-spring-end', 'sched-spring-start', 'sched-spring-sem-start'];
         clearInputs.forEach(id => setVal(id, ''));

         this.currentFixedHolidays = {};
         this.currentVariableHolidays = [];
         this.currentMajorEvents = [];
         
         // Mapping Code -> DOM
         const codeMap = {
             'TERM1_START': 'sched-sem1-start',
             'SUMMER_VAC': { s: 'sched-summer-start', e: 'sched-summer-end' },
             'SUMMER_VAC_CEREMONY': 'sched-summer-start-ceremony',
             'TERM2_START': 'sched-sem2-start',
             'WINTER_VAC_CEREMONY': 'sched-winter-start-ceremony',
             'WINTER_VAC': { s: 'sched-winter-start', e: 'sched-winter-end' },
             'SPRING_VAC_CEREMONY': 'sched-spring-start-ceremony',
             'SPRING_VAC': { s: 'sched-spring-start', e: 'sched-spring-end' },
             'SPRING_SEM_START': 'sched-spring-sem-start'
         };

         // Parse Rows
         schedules.forEach(row => {
             // System Codes
             if (row.code) {
                 if (row.type === 'exam') {
                      // Exams (EXAM_X_X)
                      const doms = {
                          'EXAM_1_1': { s: 'sched-exam-1-1-start', e: 'sched-exam-1-1-end' },
                          'EXAM_1_2': { s: 'sched-exam-1-2-start', e: 'sched-exam-1-2-end' },
                          'EXAM_2_1': { s: 'sched-exam-2-1-start', e: 'sched-exam-2-1-end' },
                          'EXAM_2_2': { s: 'sched-exam-2-2-start', e: 'sched-exam-2-2-end' },
                          'EXAM_3_2_2': { s: 'sched-exam-3-2-2-start', e: 'sched-exam-3-2-2-end' }
                      };
                      if (doms[row.code]) {
                          setVal(doms[row.code].s, row.start_date);
                          setVal(doms[row.code].e, row.end_date);
                      }
                 } else {
                     // Terms/Vac
                     const target = codeMap[row.code];
                     if (target) {
                         if (typeof target === 'string') {
                             setVal(target, row.start_date);
                         } else {
                             setVal(target.s, row.start_date);
                             setVal(target.e, row.end_date);
                         }
                     }
                 }
             } else {
                 // No Code -> Collections
                 if (row.type === 'holiday') {
                      if (row.is_holiday) { // Fixed or Variable check effectively
                          // We treat all holidays from DB as "Variable" for editing purposes in UI unless we match fixed list logic?
                          // Actually, standard fixed holidays (3.1 etc) are calc'd. 
                          // If we find them in DB, we should separate them.
                          // But wait, the SAVE logic dumped calc'd holidays into DB too.
                          // So on LOAD, we should probably distinct them.
                          // Simple strategy: Just put everything in "Variable" container for now? 
                          // User wants to see "Fixed" separately usually.
                          // Let's rely on standard Calc for "Fixed" and filtered DB rows for "Variable" if possible?
                          // But we SAVED everything.
                          // Let's filter: if date matches result of 'calculateMergedHolidays', put in Fixed, else Variable.
                          const fixedRef = this.calculateMergedHolidays(targetY);
                          // We need simple check.
                          // Actually, let's just populate currentVariableHolidays.
                          // BUT, user sees Fixed List separately.
                          // Optimization: Filter out names that match standard fixed holidays for that date.
                      } 
                 }
             }
         });

         // Refine Holidays Loading
         // 1. Calculate Standard Fixed
         const standardFixed = this.calculateMergedHolidays(targetY);
         this.currentFixedHolidays = standardFixed; // Always use standard calc for display consistency
         this.renderFixedHolidays(this.currentFixedHolidays);

         // 2. Identify Variables (In DB but not in Standard)
         const variableRows = schedules.filter(r => r.type === 'holiday');
         variableRows.forEach(r => {
             // Check if this date/name exists in standard
             // Note: standardFixed is { 'YYYY-MM-DD': 'Name' }
             const standardName = standardFixed[r.start_date];
             if (!standardName) {
                 // True variable holiday (or manually added)
                 this.currentVariableHolidays.push({ date: r.start_date, name: r.name });
             }
         });
         this.currentVariableHolidays.sort((a,b) => a.date.localeCompare(b.date));
         this.renderVariableHolidays(this.currentVariableHolidays);

         // 3. Major Events (No Code, Type=event)
         // Filter out Ceremonies if they have codes (which they do)
         const majorRows = schedules.filter(r => r.type === 'event' && !r.code);
         majorRows.forEach(r => {
             this.currentMajorEvents.push({ start: r.start_date, end: r.end_date, name: r.name });
         });
         this.currentMajorEvents.sort((a,b) => a.start.localeCompare(b.start));
         this.renderMajorEvents(this.currentMajorEvents);
         
         // 4. Env Events (Fixed)
         this.renderFixedEnvEvents();
    },
    
    renderFixedHolidays: function(holidays) {
        const container = document.getElementById('fixed-holidays-list');
        if(!container) return;
        container.innerHTML = '';
        
        const getSortWeight = (dateKey) => {
            const parts = dateKey.split('-');
            const mmdd = parts.length === 3 ? parts[1] + parts[2] : dateKey;
            const mm = parseInt(mmdd.substring(0, 2));
            const dd = parseInt(mmdd.substring(2, 4));
            const sortMm = (mm < 3) ? mm + 12 : mm;
            return sortMm * 100 + dd;
        };

        const sorted = Object.entries(holidays).sort((a, b) => getSortWeight(a[0]) - getSortWeight(b[0]));
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

        sorted.forEach(([dateKey, name]) => {
            const div = document.createElement('div');
            // Fixed height h-[40px] to match inputs
            div.className = "flex items-center justify-between bg-white px-3 h-[40px] rounded border border-gray-100 shadow-sm mb-1 hover:bg-purple-50 transition-colors";
            
            let displayDate = dateKey;
            if (dateKey.length === 10) {
                const d = new Date(dateKey);
                displayDate = `${dateKey}(${dayNames[d.getDay()]})`;
            }

            const isSubstitute = name.includes('대체');
            div.innerHTML = `
                <span class="font-medium text-sm ${isSubstitute ? 'text-blue-600' : 'text-gray-700'}">${displayDate}</span>
                <span class="text-sm ${isSubstitute ? 'text-blue-500 font-medium' : 'text-gray-500'}">${name}</span>
            `;
            container.appendChild(div);
        });
    },

    /**
     * Calculates all holidays for the given academic year, including Lunar and Alternative holidays.
     */
    calculateMergedHolidays: function(academicYear) {
        const year = parseInt(academicYear);
        const baseHolidays = {
            "0301": "삼일절", "0501": "근로자의날", "0505": "어린이날", 
            "0606": "현충일", "0717": "제헌절", "0815": "광복절", "1003": "개천절", 
            "1009": "한글날", "1225": "성탄절", "0101": "신정"
        };
        const results = {}; // key: YYYY-MM-DD, value: name

        // 1. Add Base Fixed Holidays
        Object.entries(baseHolidays).forEach(([mmdd, name]) => {
            const mm = parseInt(mmdd.substring(0, 2));
            const y = (mm < 3) ? year + 1 : year;
            results[`${y}-${mmdd.substring(0, 2)}-${mmdd.substring(2, 4)}`] = name;
        });

        // 2. Add Lunar Holidays
        // Buddha's Birthday
        const solarBuddha = this.getSolarFromLunar(year, "0408");
        if(solarBuddha) results[solarBuddha] = (results[solarBuddha] ? results[solarBuddha] + ", " : "") + "부처님오신날";

        // Lunar New Year & Chuseok with Eve/After days
        const addLunarSpan = (lmmdd, mainName) => {
            const mainSolar = this.getSolarFromLunar(year, lmmdd);
            if(mainSolar) {
                const eve = this.adjustSolarDate(mainSolar, -1);
                const after = this.adjustSolarDate(mainSolar, 1);
                results[eve] = (results[eve] ? results[eve] + ", " : "") + `${mainName} 연휴`;
                results[mainSolar] = (results[mainSolar] ? results[mainSolar] + ", " : "") + mainName;
                results[after] = (results[after] ? results[after] + ", " : "") + `${mainName} 연휴`;
            }
        };
        addLunarSpan("0101", "설날");
        addLunarSpan("0815", "추석");

        // 3. Calculate Alternative Holidays (Substitute)
        // Rule: 
        // - 설날, 추석, 어린이날: 일요일 또는 다른 공휴일과 겹칠 경우 (단, 설날/추석은 토요일 겹침 무시)
        // - 국경일(3.1, 8.15, 10.3, 10.9), 성탄절, 부처님오신날: 토요일 또는 일요일과 겹칠 경우
        const isEligibleForSub = (name) => {
            if (["삼일절", "광복절", "개천절", "한글날", "성탄절", "부처님오신날"].includes(name)) return "weekend";
            if (["어린이날"].includes(name)) return "all"; // Sat, Sun, or other holiday
            if (["설날", "설날 연휴", "추석", "추석 연휴"].includes(name)) return "sunday";
            return null;
        };

        const sortedDays = Object.keys(results).sort();
        const substitutes = {};

        sortedDays.forEach(dateStr => {
            const names = results[dateStr].split(", ");
            names.forEach(name => {
                const type = isEligibleForSub(name);
                if (!type) return;

                const d = new Date(dateStr);
                const dayNum = d.getDay(); // 0:Sun, 6:Sat
                let needsSub = false;

                if (type === "weekend" && (dayNum === 0 || dayNum === 6)) needsSub = true;
                else if (type === "sunday" && dayNum === 0) needsSub = true;
                else if (type === "all" && (dayNum === 0 || dayNum === 6)) needsSub = true; 
                // Note: overlap with other holiday check would need more complex multi-pass, but Sat/Sun covers most.

                if (needsSub) {
                    let subDate = this.adjustSolarDate(dateStr, 1);
                    while (true) {
                        const sd = new Date(subDate);
                        const sNum = sd.getDay();
                        // Next non-weekend and non-existing holiday
                        if (sNum !== 0 && sNum !== 6 && !results[subDate] && !substitutes[subDate]) {
                            substitutes[subDate] = `대체공휴일(${name})`;
                            break;
                        }
                        subDate = this.adjustSolarDate(subDate, 1);
                    }
                }
            });
        });

        return { ...results, ...substitutes };
    },

    adjustSolarDate: (solarStr, days) => {
        const d = new Date(solarStr);
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },

    renderVariableHolidays: function(list) {
        const container = document.getElementById('variable-holidays-container');
        if(!container) return;
        container.innerHTML = '';
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        
        list.forEach((item, idx) => {
            const div = document.createElement('div');
            const isEditing = !item.date || !item.name || item.isEditing;

            if (isEditing) {
                // Remove bg-white, border, shadow when editing as requested
                div.className = "flex items-center justify-between px-1 h-[40px] mb-1 group transition-all";
                div.innerHTML = `
                    <div class="flex items-center gap-1 w-full overflow-hidden">
                        <input type="date" value="${item.date || ''}" max="2099-12-31"
                            class="holiday-date border border-gray-300 rounded px-2 h-[32px] text-sm w-[140px] focus:ring-2 focus:ring-purple-400" />
                        <input type="text" value="${item.name || ''}" placeholder="명칭" 
                            class="holiday-name border border-gray-300 rounded px-2 h-[32px] text-sm flex-grow focus:ring-2 focus:ring-purple-400" />
                        <button type="button" class="btn-del-hol text-red-300 hover:text-red-500 flex items-center shrink-0 ml-1">
                            <span class="material-symbols-outlined text-lg">delete</span>
                        </button>
                    </div>
                `;
            } else {
                // View mode: keep the "box" look to match fixed holidays
                div.className = "flex items-center justify-between bg-white px-3 h-[40px] rounded border border-gray-100 shadow-sm mb-1 group hover:bg-purple-50 transition-all cursor-pointer";
                
                let displayDate = item.date;
                try {
                    const d = new Date(item.date);
                    if (!isNaN(d.getTime())) displayDate = `${item.date}(${dayNames[d.getDay()]})`;
                } catch(e) {}

                div.innerHTML = `
                    <span class="font-medium text-sm text-gray-700">${displayDate}</span>
                    <div class="flex items-center gap-2">
                        <span class="text-sm text-gray-500">${item.name}</span>
                        <button type="button" class="btn-edit-hol opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity mr-1">
                            <span class="material-symbols-outlined text-lg">edit</span>
                        </button>
                        <button type="button" class="btn-del-hol opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 transition-opacity">
                            <span class="material-symbols-outlined text-lg">delete</span>
                        </button>
                    </div>
                `;
                
                div.onclick = (e) => {
                    if (e.target.closest('.btn-del-hol')) return;
                    this.syncVariableHolidaysFromUI();
                    this.currentVariableHolidays[idx].isEditing = true;
                    this.renderVariableHolidays(this.currentVariableHolidays);
                };
            }

            container.appendChild(div);
            
            const delBtn = div.querySelector('.btn-del-hol');
            if(delBtn) {
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.syncVariableHolidaysFromUI();
                    this.currentVariableHolidays.splice(idx, 1);
                    this.renderVariableHolidays(this.currentVariableHolidays);
                };
            }
        });
    },

    syncVariableHolidaysFromUI: function() {
        const container = document.getElementById('variable-holidays-container');
        if(!container) return;

        const newList = [];
        Array.from(container.children).forEach((div, i) => {
            const dateInput = div.querySelector('.holiday-date');
            const nameInput = div.querySelector('.holiday-name');
            
            if (dateInput && nameInput) {
                newList.push({ 
                    date: dateInput.value, 
                    name: nameInput.value,
                    isEditing: true
                });
            } else {
                if (this.currentVariableHolidays && this.currentVariableHolidays[i]) {
                    newList.push(this.currentVariableHolidays[i]);
                }
            }
        });
        this.currentVariableHolidays = newList;
    },

    renderMajorEvents: function(list) {
        const container = document.getElementById('major-events-container');
        if(!container) return;
        container.innerHTML = '';
        
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const getDisplayDate = (dateStr) => {
            if(!dateStr) return '';
            try {
                const d = new Date(dateStr);
                if (!isNaN(d.getTime())) return `${dateStr}(${dayNames[d.getDay()]})`;
            } catch(e) {}
            return dateStr;
        };
        
        list.forEach((item, idx) => {
            const div = document.createElement('div');
            const isEditing = !item.start || !item.name || item.isEditing;

            if (isEditing) {
                div.className = "flex items-center gap-1 w-full p-1 border border-gray-200 rounded mb-1 bg-gray-50 h-[40px]";
                div.innerHTML = `
                    <input type="date" value="${item.start || ''}" max="2099-12-31"
                        class="event-start border border-gray-300 rounded px-1 h-[30px] text-xs w-[105px] focus:ring-1 focus:ring-blue-400" />
                    <span class="text-gray-400 text-xs">~</span>
                    <input type="date" value="${item.end || ''}" max="2099-12-31"
                        class="event-end border border-gray-300 rounded px-1 h-[30px] text-xs w-[105px] focus:ring-1 focus:ring-blue-400" />
                    
                    <input type="text" value="${item.name || ''}" placeholder="행사명" 
                        class="event-name flex-grow border border-gray-300 rounded px-2 h-[30px] text-xs focus:ring-1 focus:ring-blue-400 min-w-0" />
                    
                    <button type="button" class="btn-del-major text-red-400 hover:text-red-600 shrink-0">
                        <span class="material-symbols-outlined text-lg">delete</span>
                    </button>
                `;
            } else {
                div.className = "flex items-center justify-between bg-white px-3 h-[40px] rounded border border-gray-100 shadow-sm mb-1 group hover:bg-blue-50 transition-all cursor-pointer";
                
                let dateStr = getDisplayDate(item.start);
                if(item.end && item.end !== item.start) {
                    dateStr += ` ~ ${getDisplayDate(item.end)}`;
                }

                div.innerHTML = `
                    <span class="font-medium text-sm text-gray-700">${dateStr}</span>
                    <div class="flex items-center gap-2">
                        <span class="text-sm text-gray-500">${item.name}</span>
                        <button type="button" class="btn-edit-major opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity mr-1">
                            <span class="material-symbols-outlined text-lg">edit</span>
                        </button>
                        <button type="button" class="btn-del-major opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 transition-opacity">
                            <span class="material-symbols-outlined text-lg">delete</span>
                        </button>
                    </div>
                `;
                
                div.onclick = (e) => {
                    if (e.target.closest('.btn-del-major')) return;
                    this.syncMajorEventsFromUI();
                    this.currentMajorEvents[idx].isEditing = true;
                    this.renderMajorEvents(this.currentMajorEvents);
                };
            }

            container.appendChild(div);
            
            const delBtn = div.querySelector('.btn-del-major');
            if(delBtn) {
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.syncMajorEventsFromUI();
                    this.currentMajorEvents.splice(idx, 1);
                    this.renderMajorEvents(this.currentMajorEvents);
                };
            }
        });
    },

    renderFixedEnvEvents: function() {
        const container = document.getElementById('fixed-env-events-list');
        if(!container || !this.FIXED_ENV_EVENTS) return;
        container.innerHTML = '';
        
        const year = this.state.currentYear || new Date().getFullYear();
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

        // Sort by date MMDD
        const sorted = Object.entries(this.FIXED_ENV_EVENTS).sort((a,b) => a[0].localeCompare(b[0]));
        
        sorted.forEach(([dateKey, name]) => {
            const div = document.createElement('div');
            div.className = "flex items-center justify-between bg-white px-3 h-[40px] rounded border border-gray-100 shadow-sm mb-1 hover:bg-green-50 transition-colors";
            
            const fullDate = `${year}-${dateKey}`;
            let displayDate = fullDate;
            try {
                const d = new Date(fullDate);
                if (!isNaN(d.getTime())) {
                    displayDate = `${fullDate}(${dayNames[d.getDay()]})`;
                }
            } catch(e) {}

            div.innerHTML = `
                <span class="font-medium text-sm text-gray-700">${displayDate}</span>
                <span class="text-sm text-green-600 font-medium">${name}</span>
            `;
            container.appendChild(div);
        });
    },

    syncMajorEventsFromUI: function() {
        const container = document.getElementById('major-events-container');
        if(!container) return;

        const newList = [];
        Array.from(container.children).forEach((div, i) => {
            const nameInput = div.querySelector('.event-name');
            const startInput = div.querySelector('.event-start');
            const endInput = div.querySelector('.event-end');
            
            if (nameInput && startInput) {
                newList.push({ 
                    start: startInput.value,
                    end: (endInput && endInput.value) ? endInput.value : '', 
                    name: nameInput.value,
                    isEditing: true
                });
            } else {
                if (this.currentMajorEvents && this.currentMajorEvents[i]) {
                    newList.push(this.currentMajorEvents[i]);
                }
            }
        });
        this.currentMajorEvents = newList;
    },

    getSolarFromLunar: function(academicYear, mmdd) {
        if(!window.KoreanLunarCalendar || !mmdd || mmdd.length !== 4) return null;
        try {
            const mm = parseInt(mmdd.substring(0, 2));
            const dd = parseInt(mmdd.substring(2, 4));
            
            const baseYear = parseInt(academicYear);
            const targetYear = (mm <= 5) ? baseYear + 1 : baseYear; // Feb(Jan-Lunar) or Buddha's Birthday(late lunar)
            // Wait, Buddha's Birthday (0408 Lunar) usually falls in May/June of the SAME year.
            // Lunar New Year (0101 Lunar) usually falls in Jan/Feb of the NEXT calendar year.
            
            let finalTargetYear = baseYear;
            if (mm <= 2) finalTargetYear = baseYear + 1; // 1, 2 lunar is always next calendar year for academic start in March
            
            const converter = new window.KoreanLunarCalendar();
            converter.setLunarDate(finalTargetYear, mm, dd, false);
            const solar = converter.getSolarCalendar();
            
            if (!solar.year || !solar.month || !solar.day) return null;
            
            return `${solar.year}-${String(solar.month).padStart(2,'0')}-${String(solar.day).padStart(2,'0')}`;
        } catch(e) {
            return null;
        }
    },

    handleSaveSchoolInfo: async function() {
        const { data: { session } } = await window.SupabaseClient.supabase.auth.getSession();
        if (!session || this.state.role !== 'admin') {
            alert('세션이 만료되었거나 관리자 권한이 없습니다. 다시 로그인해 주세요.');
            if (!session) this.navigate('login');
            return;
        }

        const getVal = (id) => document.getElementById(id)?.value || '';
        
        const schoolNameKR = getVal('setting-school-name-kr').trim();
        const schoolNameEN = getVal('setting-school-name-en').trim();

        if (!schoolNameKR && !schoolNameEN) {
            alert('학교명(한글 또는 영문)을 입력해 주세요.');
            return;
        }

        // Combine names for storage if both exist, otherwise use one available
        let displayName = schoolNameKR;
        if (schoolNameKR && schoolNameEN) {
            displayName = `${schoolNameKR} (${schoolNameEN})`;
        } else if (!schoolNameKR && schoolNameEN) {
            displayName = schoolNameEN;
        }

        const schoolInfo = {
            full_name_kr: schoolNameKR,
            name_en: schoolNameEN,
            level_kr: getVal('setting-school-level-kr'),
            level_en: getVal('setting-school-level-en')
        };

        const academicYear = parseInt(document.getElementById('setting-academic-year').value);

        // We save school info into the 'settings' table. 
        // We preserve detailed inputs in 'schedule_data' jsonb column to reload them correctly.
        const { data: existing } = await window.SupabaseClient.supabase
            .from('settings')
            .select('id')
            .eq('academic_year', academicYear)
            .maybeSingle();

        const payload = {
            academic_year: academicYear,
            school_name: displayName,
            name_en: schoolNameEN,
            level_kr: getVal('setting-school-level-kr'),
            level_en: getVal('setting-school-level-en')
        };

        if(existing) payload.id = existing.id;

        const { error } = await window.SupabaseClient.supabase
            .from('settings')
            .upsert(payload);

        if(error) {
            alert('학교 정보 저장 실패: ' + error.message);
        } else {
            alert('학교 정보가 성공적으로 저장되었습니다.');
            location.reload();
        }
    },

    handleSaveSettings: async function() {
        const btnSave = document.getElementById('btn-save-settings');
        const originalBtnText = btnSave ? btnSave.innerHTML : '저장';

        if(btnSave) {
            btnSave.disabled = true;
            btnSave.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span> 저장 중...';
        }

        try {
            const { data: { session } } = await window.SupabaseClient.supabase.auth.getSession();
            if (!session || this.state.role !== 'admin') {
                throw new Error('세션이 만료되었거나 관리자 권한이 없습니다.');
            }

            // Collect Data
            const yearVal = document.getElementById('setting-academic-year').value;
            const academicYear = parseInt(yearVal);
            
            const getVal = (id) => {
                const val = document.getElementById(id)?.value;
                return val || '';
            };
            
            // Variable Holidays Array -> Object
            this.syncVariableHolidaysFromUI(); 
            const variableHolidays = {};
            if(this.currentVariableHolidays) {
                this.currentVariableHolidays.forEach(h => {
                    if(h.date && h.name) {
                        variableHolidays[h.date] = h.name;
                    }
                });
            }
            
            // Major Events: Consolidate User Events + Exams into Array
            this.syncMajorEventsFromUI(); 
            
            const finalMajorEvents = [];
            
            // 1. User Events
            if(this.currentMajorEvents) {
                this.currentMajorEvents.forEach(e => {
                    if(e.start && e.name) {
                        finalMajorEvents.push({
                            type: 'event',
                            start: e.start,
                            end: e.end || e.start,
                            name: e.name
                        });
                    }
                });
            }
            
            // 2. Exams Input
            const examDefinitions = [
                { code: 'EXAM_1_1', title: '1학기 1차지필', s: 'sched-exam-1-1-start', e: 'sched-exam-1-1-end' },
                { code: 'EXAM_1_2', title: '1학기 2차지필', s: 'sched-exam-1-2-start', e: 'sched-exam-1-2-end' },
                { code: 'EXAM_2_1', title: '2학기 1차지필', s: 'sched-exam-2-1-start', e: 'sched-exam-2-1-end' },
                { code: 'EXAM_2_2', title: '2학기 2차지필', s: 'sched-exam-2-2-start', e: 'sched-exam-2-2-end' },
                { code: 'EXAM_3_2_2', title: '3학년 2학기 2차지필', s: 'sched-exam-3-2-2-start', e: 'sched-exam-3-2-2-end' }
            ];
            
            examDefinitions.forEach(def => {
                const sVal = getVal(def.s);
                const eVal = getVal(def.e);
                if (sVal && eVal) {
                    finalMajorEvents.push({
                        type: 'exam',
                        code: def.code,
                        title: def.title, 
                        start: sVal,
                        end: eVal
                    });
                }
            });
            
            // Department Config Collection
            const generalDepts = [];
            document.querySelectorAll('#admin-dept-list .flex').forEach(row => {
                const nameInp = row.querySelector('.dept-name-input');
                const name = nameInp ? nameInp.value.trim() : '';
                const nickInp = row.querySelector('.dept-nickname-input');
                const nickname = nickInp ? nickInp.value.trim() : '';
                const color = row.querySelector('.dept-color-input').value;
                if(name) {
                    generalDepts.push({ name, nickname, color });
                }
            });
            

            // Prepare DB Payload (School Info ONLY)
            const schoolNameKR = getVal('setting-school-name-kr').trim();
            const schoolNameEN = getVal('setting-school-name-en').trim();
            
            let displayName = schoolNameKR;
            if (schoolNameKR && schoolNameEN) {
                displayName = `${schoolNameKR} (${schoolNameEN})`;
            } else if (!schoolNameKR && schoolNameEN) {
                displayName = schoolNameEN;
            }

            const { data: existing } = await window.SupabaseClient.supabase
                .from('settings')
                .select('id')
                .eq('academic_year', academicYear)
                .maybeSingle();

            const settingsPayload = {
                academic_year: academicYear,
                school_name: displayName,
                full_name_kr: schoolNameKR || null, // Allow NULL if empty
                name_en: schoolNameEN || null,
                level_kr: getVal('setting-school-level-kr'),
                level_en: getVal('setting-school-level-en')
            };

            if(existing) settingsPayload.id = existing.id;

            const { error: settingsError } = await window.SupabaseClient.supabase
                .from('settings')
                .upsert(settingsPayload);

            if(settingsError) throw settingsError;

            // --- Basic Schedules Migration ---
            // Flatten all data to rows
            const basicRows = [];
            const addRow = (type, code, name, start, end = null, is_holiday = false) => {
                if(!start) return;
                basicRows.push({
                    academic_year: academicYear,
                    type,
                    code,
                    name,
                    start_date: start,
                    end_date: end || start,
                    is_holiday
                });
            };

            // 1. Terms & Vacations
            addRow('term', 'TERM1_START', '1학기 개학', getVal('sched-sem1-start'));
            addRow('vacation', 'SUMMER_VAC', '여름방학', getVal('sched-summer-start'), getVal('sched-summer-end'));
            addRow('event', 'SUMMER_VAC_CEREMONY', '여름방학식', getVal('sched-summer-start-ceremony'));
            addRow('term', 'TERM2_START', '2학기 개학', getVal('sched-sem2-start'));
            addRow('event', 'WINTER_VAC_CEREMONY', '겨울방학식', getVal('sched-winter-start-ceremony'));
            addRow('vacation', 'WINTER_VAC', '겨울방학', getVal('sched-winter-start'), getVal('sched-winter-end'));
            addRow('event', 'SPRING_VAC_CEREMONY', '봄방학식', getVal('sched-spring-start-ceremony'));
            addRow('vacation', 'SPRING_VAC', '봄방학', getVal('sched-spring-start'), getVal('sched-spring-end'));
            addRow('term', 'SPRING_SEM_START', '봄 개학', getVal('sched-spring-sem-start'));

            // 2. Fixed Holidays
            if(this.currentFixedHolidays) {
                Object.entries(this.currentFixedHolidays).forEach(([date, name]) => {
                    addRow('holiday', null, name, date, null, true);
                });
            }

            // 3. Variable Holidays
            if(variableHolidays) {
                Object.entries(variableHolidays).forEach(([date, name]) => {
                    addRow('holiday', null, name, date, null, true);
                });
            }

            // 4. Exams
            examDefinitions.forEach(def => {
                const s = getVal(def.s);
                const e = getVal(def.e);
                if(s && e) {
                    addRow('exam', def.code, def.title, s, e);
                }
            });

            // 5. Major Events
            finalMajorEvents.forEach(ev => {
                 if(ev.type !== 'exam') { // Exams already added above if they were in the list, but we separated logic.
                     addRow('event', null, ev.name, ev.start, ev.end);
                 }
            });

            // Transaction-like: Delete old -> Insert new
            const { error: delError } = await window.SupabaseClient.supabase
                .from('basic_schedules')
                .delete()
                .eq('academic_year', academicYear);
            
            if(delError) throw delError;

            if(basicRows.length > 0) {
                const { error: insError } = await window.SupabaseClient.supabase
                    .from('basic_schedules')
                    .insert(basicRows);
                if(insError) throw insError;
            }

            // Sync Departments (Delete Old -> Insert New)
            await window.SupabaseClient.supabase
                .from('departments')
                .delete()
                .eq('academic_year', academicYear);
            
            const deptPayload = [];
            
            // 1. General
            generalDepts.forEach((d, i) => {
                deptPayload.push({
                    academic_year: academicYear,
                    dept_name: d.name,
                    dept_short: d.nickname,
                    dept_color: d.color,
                    sort_order: i, // 0 to N
                    is_active: true
                });
            });
            
            // 2. Special - Save ALL (Active & Inactive) so we persist preferences
            document.querySelectorAll('.special-dept-row').forEach((row, i) => {
                const name = row.dataset.name;
                const nickname = row.querySelector('.special-dept-nickname').value;
                const color = row.querySelector('.special-dept-color').value;
                const active = row.querySelector('.special-dept-check').checked;
                
                 deptPayload.push({
                    academic_year: academicYear,
                    dept_name: name,
                    dept_short: nickname,
                    dept_color: color,
                    sort_order: 100 + i, 
                    is_active: active
                 });
            });
            
            if (deptPayload.length > 0) {
                const { error: deptError } = await window.SupabaseClient.supabase
                    .from('departments')
                    .insert(deptPayload);
                
                if (deptError) throw deptError;
            }

            alert('학교 정보가 성공적으로 저장되었습니다.');
            location.reload();

        } catch (err) {
            console.error(err);
            alert('저장 실패: ' + (err.message || '알 수 없는 오류'));
            if(btnSave) {
                btnSave.disabled = false;
                btnSave.innerHTML = originalBtnText;
            }
        }
    },

    updateBrand: function(schoolNameKR, schoolNameEN) {
        let display = 'GOELink';
        if (schoolNameKR || schoolNameEN) {
            if (schoolNameKR && schoolNameEN) {
                display = `${schoolNameKR} (${schoolNameEN})`;
            } else {
                display = schoolNameKR || schoolNameEN;
            }
        }
        
        const brandLabel = document.querySelector('h1.text-xl');
        if (brandLabel) {
            brandLabel.innerHTML = `${display} <span class="text-xs font-normal text-gray-500 ml-1">v2.0</span>`;
        }
    },


    // --- End of Schedules Management ---



    loadAdminUsers: async function () {
        const listContainer = document.getElementById('admin-user-list');
        if (!listContainer) return;

        try {
            const { data: users, error } = await window.SupabaseClient.supabase
                .from('user_roles')
                .select('*')
                .order('last_login', { ascending: false });

            if (error) throw error;

            if (users && users.length > 0) {
                listContainer.innerHTML = users.map(u => `
                    <div class="flex items-center justify-between p-2 border rounded hover:bg-gray-50">
                        <div>
                            <div class="font-bold text-sm text-gray-800">${u.email}</div>
                            <div class="text-xs text-gray-500">최근 접속: ${new Date(u.last_login).toLocaleDateString()}</div>
                        </div>
                        <div class="flex items-center gap-2">
                            <select onchange="window.App.updateUserRole('${u.user_id}', this.value)" class="text-xs border rounded p-1 ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : (u.role === 'head' ? 'bg-blue-100 text-blue-700' : 'bg-white')}">
                                <option value="teacher" ${u.role === "teacher" ? "selected" : ""}>일반 (Teacher)</option>
                                <option value="head" ${u.role === "head" ? "selected" : ""}>부장 (Head)</option>
                                <option value="admin" ${u.role === "admin" ? "selected" : ""}>관리자 (Admin)</option>
                            </select>
                            <select onchange="window.App.updateUserStatus('${u.user_id}', this.value)" class="text-xs border rounded p-1 ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100'}">
                                <option value="pending" ${u.status === "pending" ? "selected" : ""}>대기</option>
                                <option value="active" ${u.status === "active" ? "selected" : ""}>승인</option>
                                <option value="rejected" ${u.status === "rejected" ? "selected" : ""}>거부</option>
                            </select>
                        </div>
                    </div>
                `).join('');
            } else {
                listContainer.innerHTML = "<p class='text-gray-400 text-center py-4'>사용자가 없습니다.</p>";
            }
        } catch (e) {
            console.error("Load Users Failed:", e);
            listContainer.innerHTML = "<p class='text-red-500 text-center py-4'>데이터 로딩 실패</p>";
        }
    },

    updateUserRole: async function (userId, newRole) {
        if (!confirm("권한을 변경하시겠습니까?")) {
            this.loadAdminUsers(); // Revert UI
            return;
        }

        const { error } = await window.SupabaseClient.supabase
            .from('user_roles')
            .update({ role: newRole })
            .eq('user_id', userId);

        if (error) {
            alert("업데이트 실패: " + error.message);
        } else {
            this.loadAdminUsers(); // Refresh
            this.logAction('UPDATE_ROLE', 'user_roles', userId, { newRole });
        }
    },

    updateUserStatus: async function (userId, newStatus) {
        const { error } = await window.SupabaseClient.supabase
            .from('user_roles')
            .update({ status: newStatus })
            .eq('user_id', userId);

        this.logAction('UPDATE_STATUS', 'user_roles', userId, { newStatus });
    },

    loadAuditLogs: async function () {
        const auditList = document.getElementById('admin-audit-list');
        if (auditList) {
            try {
                const { data: logs, error } = await window.SupabaseClient.supabase
                    .from('audit_logs')
                    .select('*')
                    .order('timestamp', { ascending: false })
                    .limit(20);

                if (error) throw error;

                if (logs && logs.length > 0) {
                    auditList.innerHTML = logs.map(log => `
                        <div class="border-b last:border-0 pb-2 mb-2">
                            <div class="flex justify-between items-center mb-1">
                                <span class="font-bold text-gray-800 text-xs px-2 py-0.5 rounded bg-gray-100">${log.action_type}</span>
                                <span class="text-xs text-gray-400">${new Date(log.timestamp).toLocaleString()}</span>
                            </div>
                            <div class="text-gray-600 truncate">${log.details ? JSON.stringify(JSON.parse(log.details)) : '-'}</div>
                        </div>
                    `).join('');
                } else {
                    auditList.innerHTML = "<p class='text-gray-400 text-center py-4'>기록된 로그가 없습니다.</p>";
                }
            } catch (e) {
                console.error("Failed to fetch audit logs:", e);
                auditList.innerHTML = "<p class='text-red-400 text-center py-4'>로그 로딩 실패</p>";
            }
        }
    },

    initCalendar: async function () {
        const calendarEl = document.getElementById('calendar');
        if (!calendarEl) return;

        // 1. Fetch Metadata (Settings, Departments)
        const [settings, departments] = await Promise.all([
            this.fetchSettings(),
            this.fetchDepartments()
        ]);

        this.state.departments = departments;
        // Sidebar/Filters removed as per user request
        
        // 2. Fetch Events (Schedules)
        const schedules = await this.fetchSchedules();
        this.state.schedules = schedules; // Cache for search

        // 3. Prepare Events for FullCalendar
        const allEvents = this.transformEvents(schedules, settings, departments, settings.basic_schedules);
        
        // Split into Background (Holiday) and Foreground (Schedule)
        const backgroundEvents = [];
        const scheduleMap = {}; // { 'YYYY-MM-DD': { deptId: { info: deptObj, events: [eventObj] } } }

        // Build Holiday Map for Cell Rendering (Title injection)
        const holidayMap = {};
        const redDayMap = {}; // Track Real Holidays

        allEvents.forEach(e => {
            if (e.display === 'background' || e.display === 'block') { // Holidays & Env Days
                // For holidays, we keep using them as background events in FullCalendar 
                // to handle the red shading.
                if (e.display === 'background') {
                    backgroundEvents.push(e);
                }
                
                // Add to holidayMap for top-left labels
                // Check if it's a holiday or special event type
                if (e.className.includes('holiday-bg-event') || e.className.includes('event-major-text') || e.className.includes('event-env-text') || e.className.includes('event-exam-text')) {
                     const dateKey = e.start; 
                     if (!holidayMap[dateKey]) holidayMap[dateKey] = [];
                     
                     const label = e.extendedProps?.label || e.title;
                     if (label && !holidayMap[dateKey].includes(label)) {
                         holidayMap[dateKey].push(label);
                     }
                     
                     // Identify Real Holidays
                     if (e.className.includes('holiday-bg-event')) {
                         redDayMap[dateKey] = true;
                     }
                }

            } else {
                // Regular Schedule
                // Group by Date -> Dept
                let current = new Date(e.start);
                const end = e.end ? new Date(e.end) : new Date(e.start);
                
                // Loop through days (simple handling for V1, assuming reasonable ranges)
                let daysCount = 0;
                while (current < end || (current.getTime() === end.getTime() && !e.end)) {
                    if (daysCount > 365) break; 
                    
                    const year = current.getFullYear();
                    const month = String(current.getMonth() + 1).padStart(2, '0');
                    const day = String(current.getDate()).padStart(2, '0');
                    const dKey = `${year}-${month}-${day}`;
                    
                    if (!scheduleMap[dKey]) scheduleMap[dKey] = {};
                    
                    const deptId = e.extendedProps.deptId || 'uncategorized';
                    if (!scheduleMap[dKey][deptId]) {
                         // Find dept info
                         const deptDetails = this.state.departments.find(d => d.id == deptId) || { dept_name: '기타', dept_color: '#333' };
                         scheduleMap[dKey][deptId] = {
                             info: deptDetails,
                             events: []
                         };
                    }
                    scheduleMap[dKey][deptId].events.push(e);

                    // Next day
                    current.setDate(current.getDate() + 1);
                    if (!e.end) break; // Single day event
                }
            }
        });

        // 4. Bind Search
        const searchInput = document.getElementById('search-schedule');
        const searchResults = document.getElementById('search-results');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                if (query.length < 2) {
                    searchResults.classList.add('hidden');
                    return;
                }

                const matches = this.state.schedules.filter(s =>
                    s.title.toLowerCase().includes(query) ||
                    (s.description && s.description.toLowerCase().includes(query))
                );

                searchResults.classList.remove('hidden');
                if (matches.length === 0) {
                    searchResults.innerHTML = `<div class="text-gray-400 p-2 text-xs">검색 결과가 없습니다.</div>`;
                } else {
                    searchResults.innerHTML = matches.map(s => `
                        <div class="cursor-pointer hover:bg-purple-50 p-2 rounded truncate border-b last:border-0" data-date="${s.start_date}" data-id="${s.id}">
                            <div class="font-bold text-gray-700 text-xs">${s.title}</div>
                            <div class="text-xs text-gray-500">${s.start_date}</div>
                        </div>
                    `).join('');

                    // Bind clicks
                    searchResults.querySelectorAll('div[data-date]').forEach(el => {
                        el.onclick = () => {
                            this.state.calendar.gotoDate(el.dataset.date);
                            searchResults.classList.add('hidden');
                            searchInput.value = '';
                        };
                    });
                }
            });
            
            // Close search on click outside
            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                    searchResults.classList.add('hidden');
                }
            });
        }

        // 5. Initialize FullCalendar
        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth',
            locale: 'ko',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,listWeek'
            },
            buttonText: {
                today: '오늘',
                month: '월',
                list: '목록'
            },
            height: 'auto',
            dayMaxEvents: false,
            weekends: false, 
            firstDay: 1, // Start on Monday
            events: backgroundEvents, // Only backgrounds
            
            // Custom Classes for Red Dates
            // Custom Classes for Red Dates
            dayCellClassNames: (arg) => {
                const year = arg.date.getFullYear();
                const month = String(arg.date.getMonth() + 1).padStart(2, '0');
                const day = String(arg.date.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                
                // 1. Fixed/Variable Holiday -> RED
                if (redDayMap[dateStr]) {
                    return ['is-holiday'];
                }
                
                // 2. Major/Env Event on Weekend -> RED (User Request)
                if (holidayMap[dateStr]) {
                    const d = arg.date.getDay();
                    if (d === 0 || d === 6) return ['is-holiday'];
                }
                
                return [];
            },

            // Custom Content (Holiday Name + Date + Grouped Schedules)
            dayCellContent: (arg) => {
                const year = arg.date.getFullYear();
                const month = String(arg.date.getMonth() + 1).padStart(2, '0');
                const day = String(arg.date.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                // Container
                const container = document.createElement('div');
                container.className = "flex flex-col h-full w-full justify-start items-start";

                // 1. Holiday Header Row
                const headerRow = document.createElement('div');
                headerRow.style.display = 'grid';
                headerRow.style.gridTemplateColumns = 'minmax(0, 1fr) 32px'; // Stricter bounds
                headerRow.style.alignItems = 'baseline'; 
                headerRow.style.width = '100%';
                headerRow.style.marginBottom = '2px';
                
                if (holidayMap[dateStr]) {
                    // Container for hanging punctuation strategy
                    const nameContainer = document.createElement('div');
                    nameContainer.style.overflow = 'hidden'; 
                    nameContainer.style.textAlign = 'right';
                    nameContainer.style.lineHeight = '1.2';
                    nameContainer.style.paddingTop = '3px'; 
                    nameContainer.style.marginRight = '2px'; // Slight gap from date column
                    
                    holidayMap[dateStr].forEach((name, index) => {
                        const itemSpan = document.createElement('span');
                        itemSpan.style.display = 'inline-block';
                        itemSpan.style.fontSize = '12px';
                        itemSpan.style.wordBreak = 'keep-all';
                        itemSpan.style.position = 'relative'; 
                        
                        if (index > 0) itemSpan.style.marginLeft = '3px'; // Tighter gap between items
                        
                        itemSpan.className = "holiday-name"; 
                        itemSpan.textContent = name;
                        
                        // Only add comma if NOT the last item
                        if (index < holidayMap[dateStr].length - 1) {
                            const commaSpan = document.createElement('span');
                            commaSpan.textContent = ',';
                            commaSpan.style.position = 'absolute';
                            commaSpan.style.right = '-3px'; // Tighter hang
                            commaSpan.style.top = '0';
                            itemSpan.appendChild(commaSpan);
                        }
                        
                        nameContainer.appendChild(itemSpan);
                    });
                    
                    nameContainer.title = holidayMap[dateStr].join(', '); 
                    
                    headerRow.appendChild(nameContainer);
                } else {
                     headerRow.appendChild(document.createElement('div'));
                }

                const dayLink = document.createElement('a');
                dayLink.className = "fc-daygrid-day-number";
                dayLink.style.whiteSpace = 'nowrap';
                dayLink.style.textAlign = 'right';
                dayLink.style.marginRight = '0'; 
                dayLink.style.padding = '0';
                dayLink.style.textDecoration = 'none';
                dayLink.textContent = arg.dayNumberText;
                headerRow.appendChild(dayLink);
                
                container.appendChild(headerRow);

                // 2. Scheduled Events Grouping
                if (scheduleMap[dateStr]) {
                    const groups = scheduleMap[dateStr];
                    // Sort order
                    const sortedDeptIds = Object.keys(groups).sort((a,b) => {
                        const infoA = groups[a].info;
                        const infoB = groups[b].info;
                        const idxA = this.state.departments.findIndex(d => d.id == a);
                        const idxB = this.state.departments.findIndex(d => d.id == b);
                        return idxA - idxB;
                    });

                    sortedDeptIds.forEach(deptId => {
                        const group = groups[deptId];
                        const deptDiv = document.createElement('div');
                        deptDiv.className = "w-full text-xs text-left mb-2 pl-1";
                        
                        // Header: ◈ Dept Name
                        const deptHeader = document.createElement('div');
                        deptHeader.className = "font-bold mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis";
                        deptHeader.style.color = '#000'; 
                        deptHeader.innerHTML = `<span style="color:${group.info.dept_color}">◈</span> ${group.info.dept_name}`;
                        deptDiv.appendChild(deptHeader);

                        // Events List
                        group.events.forEach(ev => {
                            const evDiv = document.createElement('div');
                            evDiv.className = "cursor-pointer hover:bg-gray-100 rounded px-1 py-0.5 break-words";
                            evDiv.textContent = ev.title; 
                            evDiv.title = ev.title; // Tooltip
                            evDiv.onclick = (e) => {
                                e.stopPropagation();
                                this.openScheduleModal(ev.id);
                            };
                            deptDiv.appendChild(evDiv);
                        });
                        
                        container.appendChild(deptDiv);
                    });
                }
                
                return { domNodes: [container] };
            },

            eventDidMount: (info) => {
               // Only background events come here now.
            },
            windowResize: (view) => {
                if (window.innerWidth < 768) {
                    calendar.changeView('listWeek');
                } else {
                    calendar.changeView('dayGridMonth');
                }
            },
            dateClick: (info) => {
                this.openScheduleModal(null, info.dateStr);
            },
            eventClick: (info) => {
                if (info.event.display !== 'background') {
                    // Safety
                    this.openScheduleModal(info.event.id);
                }
            }
        });

        this.state.calendar = calendar; 
        calendar.render();

        // Bind Sat/Sun Toggle
        const chkWeekends = document.getElementById('chk-show-weekends');
        if (chkWeekends) {
            chkWeekends.checked = false; 
            chkWeekends.addEventListener('change', (e) => {
                calendar.setOption('weekends', e.target.checked);
            });
        }
        
        // Bind New Toolbar Buttons
        document.getElementById('btn-add-schedule')?.addEventListener('click', () => {
            this.openScheduleModal(null, new Date().toISOString().split('T')[0]);
        });

        document.getElementById('btn-print-modal')?.addEventListener('click', () => {
             this.openPrintModal();
        });
    },

    // --- Data Fetching ---

    fetchSettings: async function (targetYear = null) {
        let query = window.SupabaseClient.supabase
            .from('settings')
            .select('*');
            
        if (targetYear) {
            query = query.eq('academic_year', targetYear).maybeSingle(); 
        } else {
            query = query.order('academic_year', { ascending: false }).limit(1).single();
        }

        const { data: settings, error } = await query;
        if (error && error.code !== 'PGRST116') { 
            console.error('Error fetching settings:', error);
            return {};
        }
        
        const result = settings || {};
        
        // Fetch Basic Schedules (DB Refactor)
        if (result.academic_year) {
             const { data: basicSchedules } = await window.SupabaseClient.supabase
                .from('basic_schedules')
                .select('*')
                .eq('academic_year', result.academic_year);
             
             result.basic_schedules = basicSchedules || [];
        }

        return result;
    },

    fetchDepartments: async function (year = null) {
        const targetYear = year || this.state.currentYear || new Date().getFullYear();
        
        const { data: results, error } = await window.SupabaseClient.supabase
            .from('departments')
            .select('*')
            .eq('academic_year', targetYear)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

        if (error) {
            console.error('Error fetching departments:', error);
            return [];
        }

        // Map to internal format if needed
        const mapped = results.map(d => ({
            id: d.id,
            dept_name: d.dept_name,
            dept_color: d.dept_color,
            is_special: false // We are not handling special depts via this table yet
        }));

        // Fallback: If no year-specific depts, maybe show global ones?
        // For now, just return what we find.
        return mapped;
    },

    fetchSchedules: async function () {
        // Fetch all public schedules + visible internal ones
        const { data, error } = await window.SupabaseClient.supabase
            .from('schedules')
            .select('*');

        if (error) console.error('Error fetching schedules:', error);
        return data || [];
    },

    // --- Data Transformation ---

    transformEvents: function (schedules, settings, departments, basicSchedules) {
        const events = [];
        
        // --- 1. Admin Event Deduplication Setup ---
        // We track all titles from Admin settings to skip duplicate DB schedules later.
        const normalize = (s) => (s || '').normalize('NFC').replace(/[\s\(\)\[\]\{\}\-\.~!@#$%^&*_=+|;:'",.<>?/]/g, '').toLowerCase();
        const adminEventMap = {}; // { 'YYYY-MM-DD': Set(normalizedTitles) }

        const addAdminRef = (date, name) => {
            if (!date || !name) return;
            if (!adminEventMap[date]) adminEventMap[date] = new Set();
            adminEventMap[date].add(normalize(name));
        };

        // --- 2. Process Basic Schedules (New Table) ---
        // basicSchedules is array of { type, code, name, start_date, end_date, is_holiday }
        if (basicSchedules && Array.isArray(basicSchedules)) {
            
            basicSchedules.forEach(item => {
                // Determine styling based on type
                let className = 'holiday-bg-event';
                let bgColor = '';
                let isExam = false; 

                if (item.type === 'term' || item.type === 'vacation') {
                     // Basic schedules (Header Text)
                     // If it has a code like TERM..., SUMMER..., display as header
                     // Reusing holiday class for header text styling (left-aligned)
                     className = 'holiday-bg-event'; 
                } else if (item.type === 'holiday') {
                     // Holidays
                     className = 'holiday-bg-event';
                } else if (item.type === 'exam') {
                     isExam = true;
                     className = 'event-exam-text';
                     bgColor = '#fff7ed';
                } else if (item.type === 'event') {
                     // Major Events
                     className = 'event-major-text';
                     bgColor = '#eff6ff';
                }

                // Add to Reference Map
                if (item.start_date === item.end_date || !item.end_date) {
                    addAdminRef(item.start_date, item.name);
                    events.push({
                        start: item.start_date,
                        display: 'background',
                        title: '', 
                        className: className,
                        backgroundColor: bgColor || undefined,
                        allDay: true,
                        extendedProps: { label: item.name }
                    });
                } else {
                    // Range Event (Exams, Multi-day Events)
                    // We need to add refs for every day
                    let current = new Date(item.start_date);
                    const endDate = new Date(item.end_date);
                    let loop = 0;
                    
                    // For Rendering, we can use a single Range Event IF it's background
                    // BUT FullCalendar Background events don't support "Labels" well across days unless we hack it.
                    // Our 'extendedProps.label' hack relies on dayCellContent injection which works per cell.
                    // So we must push per-day events for the labels to show up on every day.
                    
                    while (current <= endDate && loop < 365) {
                        const dStr = current.toISOString().split('T')[0];
                        addAdminRef(dStr, item.name);
                        events.push({
                            start: dStr,
                            display: 'background',
                            title: '', 
                            className: className,
                            backgroundColor: bgColor || (item.type === 'term' ? 'transparent' : undefined), // Terms are just markers
                            allDay: true,
                            extendedProps: { label: item.name }
                        });
                        current.setDate(current.getDate() + 1);
                        loop++;
                    }
                }
            });
            
            // A-3. Env Events (Fixed from App Constant)
            // These are NOT in DB currently, still calculated manually or should we move to DB?
            // Plan says "Recalculate Env Events", user didn't explicitly ask to DB them.
            // But logic says "Recalculate Env Events for newYear".
            // Let's keep them as code-based for now since they are permanent fixed dates (Earth Day etc)
            const yearVal = this.state.currentYear || new Date().getFullYear();
            const envs = this.FIXED_ENV_EVENTS || {};
            [yearVal - 1, yearVal, yearVal + 1].forEach(yVal => {
                Object.entries(envs).forEach(([mmdd, name]) => {
                    const mm = parseInt(mmdd.split('-')[0]);
                    const y = (mm < 3) ? yVal + 1 : yVal;
                    const dateStr = `${y}-${mmdd}`;
                    addAdminRef(dateStr, name);
                    events.push({
                        start: dateStr,
                        display: 'block',
                        title: name,
                        className: 'event-env-text',
                        backgroundColor: 'transparent',
                        borderColor: 'transparent',
                        textColor: '#16a34a',
                        allDay: true
                    });
                });
            });
        }

        // --- 3. Process Database Schedules (User created) ---
        const deptMap = {};
        if (departments) departments.forEach(d => deptMap[d.id] = d);

        if (schedules) {
            schedules.forEach(s => {
                // Deduplication
                const normTitle = normalize(s.title);
                const hasConflict = adminEventMap[s.start_date] && adminEventMap[s.start_date].has(normTitle);
                
                if (hasConflict) return; 

                const dept = deptMap[s.dept_id] || {};
                events.push({
                    id: s.id,
                    title: s.title,
                    start: s.start_date,
                    end: s.end_date, 
                    backgroundColor: dept.dept_color || '#3788d8',
                    borderColor: dept.dept_color || '#3788d8',
                    extendedProps: {
                        deptId: s.dept_id,
                        description: s.description,
                        visibility: s.visibility,
                        isPrintable: s.is_printable
                    }
                });
            });
        }

        return events;
    },

    renderDeptFilters: function (departments) {
        const container = document.getElementById('dept-filter-list');
        if (!container) return;

        container.innerHTML = departments.map(d => `
            <div class="flex items-center gap-2">
                <input type="checkbox" id="dept-${d.id}" value="${d.id}" class="dept-checkbox rounded ${d.is_special ? 'text-purple-600' : 'text-blue-600'} focus:ring-purple-500" checked>
                <label for="dept-${d.id}" class="flex items-center gap-2 cursor-pointer w-full">
                    <span class="w-3 h-3 rounded-full" style="background-color: ${d.dept_color}"></span>
                    <span class="${d.is_special ? 'font-bold' : ''}">${d.dept_name}</span>
                </label>
            </div>
        `).join('');

        // Add Event Listeners
        container.querySelectorAll('.dept-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                // Re-render events to trigger eventDidMount filtering
                // Or use internal filter API if available. 
                // For simplicity: refetch is expensive, so we just rerender existing events? 
                // FullCalendar doesn't have simple show/hide API for events without removing them.
                // Best simple appoach: 
                this.state.calendar.refetchEvents(); // This triggers eventDidMount again
            });
        });
    },

    // --- Modal & CRUD Logic ---

    openScheduleModal: async function (eventId = null, defaultDate = null) {
        // 1. Check Auth & Permissions
        if (!this.state.user) {
            alert('로그인이 필요한 기능입니다.');
            this.navigate('login');
            return;
        }

        const canEdit = this.state.role === 'admin' || this.state.role === 'head_teacher';
        if (!canEdit) {
            alert('일정 등록/수정 권한이 없습니다.');
            return;
        }

        // 2. Load Modal Template
        const modalContainer = document.getElementById('modal-container');
        try {
            const response = await fetch('pages/modal-schedule.html');
            modalContainer.innerHTML = await response.text();
            modalContainer.classList.remove('invisible');
        } catch (e) {
            console.error("Failed to load modal", e);
            alert('오류가 발생했습니다.');
            return;
        }

        // 3. Setup Elements
        const form = document.getElementById('schedule-form');
        const titleInput = document.getElementById('sched-title');
        const startInput = document.getElementById('sched-start');
        const endInput = document.getElementById('sched-end');
        const deptSelect = document.getElementById('sched-dept');
        const visSelect = document.getElementById('sched-visibility');
        const descInput = document.getElementById('sched-desc');
        const printCheck = document.getElementById('sched-printable');
        const btnDelete = document.getElementById('btn-delete');
        const visHint = document.getElementById('visibility-hint');

        // Recurrence Elements
        const repeatCheck = document.getElementById('sched-repeat');
        const recurSection = document.getElementById('recurrence-section'); // Wrapper
        const recurOptions = document.getElementById('recurrence-options');
        const rFreq = document.getElementById('sched-freq');
        const rUntil = document.getElementById('sched-until');

        // 4. Populate Departments
        deptSelect.innerHTML = this.state.departments.map(d =>
            `<option value="${d.id}">${d.dept_name}</option>`
        ).join('');

        // 5. Load Data (Edit Mode) or Defaults
        if (eventId) {
            document.getElementById('modal-title').textContent = '일정 수정';
            btnDelete.classList.remove('hidden');
            recurSection.classList.add('hidden'); // Hide recurrence on edit for simplicity in V1

            const event = this.state.calendar.getEventById(eventId);
            if (event) {
                document.getElementById('schedule-id').value = eventId;
                titleInput.value = event.title;
                startInput.value = event.startStr;
                endInput.value = event.endStr || event.startStr;

                if (event.allDay && event.end) {
                    const d = new Date(event.end);
                    d.setDate(d.getDate() - 1);
                    endInput.value = d.toISOString().split('T')[0];
                }

                deptSelect.value = event.extendedProps.deptId;
                visSelect.value = event.extendedProps.visibility;
                descInput.value = event.extendedProps.description || '';
                printCheck.checked = event.extendedProps.isPrintable !== false;
            }
        } else {
            recurSection.classList.remove('hidden');
            if (defaultDate) {
                startInput.value = defaultDate;
                endInput.value = defaultDate;
            } else {
                startInput.value = new Date().toISOString().split('T')[0];
                endInput.value = startInput.value;
            }
            // Init Repeat Options
            repeatCheck.checked = false;
            recurOptions.classList.add('hidden');
        }

        // 6. Event Listeners
        document.getElementById('btn-modal-close').onclick = () => this.closeModal();
        document.getElementById('btn-cancel').onclick = () => this.closeModal();

        repeatCheck.onchange = () => {
            if (repeatCheck.checked) {
                recurOptions.classList.remove('hidden');
                if (!rUntil.value) {
                    // Default until: 1 month later
                    const d = new Date(startInput.value);
                    d.setMonth(d.getMonth() + 1);
                    rUntil.value = d.toISOString().split('T')[0];
                }
            } else {
                recurOptions.classList.add('hidden');
            }
        };

        visSelect.onchange = () => {
            const hints = {
                'public': '모두에게 공개합니다.',
                'internal': '교직원에게만 공개됩니다.',
                'dept': '소속 부서원만 볼 수 있습니다.'
            };
            visHint.textContent = hints[visSelect.value] || '';
        };
        visSelect.onchange();

        btnDelete.onclick = async () => {
            if (confirm('정말 삭제하시겠습니까?')) {
                const { error } = await window.SupabaseClient.supabase
                    .from('schedules')
                    .delete()
                    .eq('id', document.getElementById('schedule-id').value);

                if (error) {
                    alert('삭제 실패: ' + error.message);
                } else {
                    this.logAction('DELETE', 'schedules', document.getElementById('schedule-id').value, { title: titleInput.value });
                    this.closeModal();
                    this.initCalendar();
                }
            }
        };

        form.onsubmit = async (e) => {
            e.preventDefault();

            const scheduleId = document.getElementById('schedule-id').value;
            const baseData = {
                title: titleInput.value,
                dept_id: deptSelect.value,
                visibility: visSelect.value,
                description: descInput.value,
                is_printable: printCheck.checked,
                author_id: this.state.user.id
            };

            const startDateStr = startInput.value;
            const endDateStr = endInput.value;

            // Recurrence Generation
            const isRecurring = !scheduleId && repeatCheck.checked;

            const btnSave = document.getElementById('btn-save');
            btnSave.disabled = true;
            btnSave.textContent = isRecurring ? '반복 일정 생성 중...' : '저장 중...';

            let batchData = [];

            if (isRecurring) {
                const untilStr = rUntil.value;
                const freq = rFreq.value;

                if (untilStr <= startDateStr) {
                    alert('반복 종료일은 시작일 이후여야 합니다.');
                    btnSave.disabled = false;
                    return;
                }

                // Calculate Duration
                const d1 = new Date(startDateStr);
                const d2 = new Date(endDateStr);
                const durationMs = d2 - d1;

                let curr = new Date(startDateStr);
                const until = new Date(untilStr);
                let limit = 0;

                while (curr <= until && limit < 52) { // Safety limit 52 (1 year weekly)
                    const loopStart = curr.toISOString().split('T')[0];
                    const loopEnd = new Date(curr.getTime() + durationMs).toISOString().split('T')[0];

                    batchData.push({
                        ...baseData,
                        start_date: loopStart,
                        end_date: loopEnd
                    });

                    // Next Step
                    if (freq === 'weekly') curr.setDate(curr.getDate() + 7);
                    else if (freq === 'biweekly') curr.setDate(curr.getDate() + 14);
                    else if (freq === 'monthly') curr.setMonth(curr.getMonth() + 1);

                    limit++;
                }

                if (batchData.length === 0) batchData.push({ ...baseData, start_date: startDateStr, end_date: endDateStr });

            } else {
                batchData.push({
                    ...baseData,
                    start_date: startDateStr,
                    end_date: endDateStr
                });
            }

            let result;
            if (scheduleId) {
                // UPDATE (Single)
                result = await window.SupabaseClient.supabase
                    .from('schedules')
                    .update(batchData[0])
                    .eq('id', scheduleId)
                    .select();
            } else {
                // INSERT (Maybe Batch)
                result = await window.SupabaseClient.supabase
                    .from('schedules')
                    .insert(batchData)
                    .select();
            }

            if (result.error) {
                console.error(result.error);
                alert('저장 실패: ' + result.error.message);
                btnSave.disabled = false;
                btnSave.textContent = '저장';
            } else {
                const action = scheduleId ? 'UPDATE' : 'INSERT';
                // Log only first ID or special bulk log
                if (batchData.length > 1) {
                    this.logAction('RECUR_INSERT', 'schedules', null, { count: batchData.length, title: baseData.title });
                } else {
                    const id = scheduleId || result.data[0].id;
                    this.logAction(action, 'schedules', id, { title: baseData.title, dept: baseData.dept_id });
                }

                this.closeModal();
                this.initCalendar();
            }
        };
    },

    closeModal: function () {
        const modalContainer = document.getElementById('modal-container');
        modalContainer.classList.add('invisible');
        modalContainer.innerHTML = '';
    },

    // --- Print Logic ---

    openPrintModal: async function () {
        const modalContainer = document.getElementById('modal-container');
        try {
            const response = await fetch('pages/modal-print.html');
            modalContainer.innerHTML = await response.text();
            modalContainer.classList.remove('invisible');
        } catch (e) {
            console.error("Failed to load print modal", e);
            return;
        }

        // Bind Events
        document.getElementById('btn-print-close').onclick = () => this.closeModal();
        document.getElementById('btn-print-cancel').onclick = () => this.closeModal();

        document.getElementById('btn-do-print').onclick = () => {
            const size = document.getElementById('print-size').value;
            const orient = document.getElementById('print-orient').value;
            const isScale = document.getElementById('print-scale').checked;
            const viewType = document.querySelector('input[name="print-view"]:checked').value;

            this.executePrint(size, orient, isScale, viewType);
        };
    },

    executePrint: function (size, orient, isScale, viewType) {
        this.closeModal();

        // 1. Prepare View
        if (this.state.calendar) {
            // Switch view if needed (e.g. to List view)
            if (viewType === 'list') {
                this.state.calendar.changeView('listMonth');
            } else {
                this.state.calendar.changeView('dayGridMonth');
            }
        }

        // 2. Apply Classes to Body
        const body = document.body;
        const previousClasses = body.className;

        body.classList.add('printing-mode');
        body.classList.add(`print-${orient}`);
        body.classList.add(`print-${size.toLowerCase()}`);
        if (isScale) body.classList.add('print-scale');

        // 3. Print
        setTimeout(() => {
            window.print();
        }, 500);

        const cleanup = () => {
            body.className = previousClasses; // Restore
            // Restore calendar view if needed
            if (this.state.calendar && viewType === 'list') {
                this.state.calendar.changeView(window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth');
            }
            window.removeEventListener('afterprint', cleanup);
        };

        window.addEventListener('afterprint', cleanup);
    },

    // --- Excel Upload Logic ---

    openExcelModal: async function () {
        const modalContainer = document.getElementById('modal-container');
        try {
            const response = await fetch('pages/modal-excel.html');
            modalContainer.innerHTML = await response.text();
            modalContainer.classList.remove('invisible');
        } catch (e) {
            console.error("Failed to load excel modal", e);
            return;
        }

        // Bind Elements
        const fileInput = document.getElementById('excel-file-input');
        const fileNameDisplay = document.getElementById('excel-file-name');
        const btnUpload = document.getElementById('btn-upload-submit');
        const statusArea = document.getElementById('upload-status-area');
        const previewCount = document.getElementById('preview-count');
        const errorList = document.getElementById('preview-error-list');
        const yearSelect = document.getElementById('excel-year-select');

        let parsedBasic = [];
        let parsedNormal = [];

        // Populate Year Options
        const currentYear = this.state.currentYear || new Date().getFullYear();
        yearSelect.innerHTML = '';
        [currentYear - 1, currentYear, currentYear + 1, currentYear + 2].forEach(y => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.text = `${y}학년도`;
            if (y === currentYear) opt.selected = true;
            yearSelect.appendChild(opt);
        });

        // Close handlers
        const close = () => {
            modalContainer.classList.add('invisible');
            modalContainer.innerHTML = '';
        };
        document.getElementById('btn-excel-close').onclick = close;
        document.getElementById('btn-excel-cancel').onclick = close;

        // Template Download
        document.getElementById('btn-download-template').onclick = () => {
            const wb = XLSX.utils.book_new();
            const ws_data = [
                ['구분(기본/휴일/일반)', '부서명(일반인 경우)', '일정명', '시작일(YYYY-MM-DD)', '종료일(YYYY-MM-DD)', '내용', '공개범위(전체/교직원/부서)'],
                // 학기/방학 행사
                ['기본', '', '1학기 개학일', '', '', '', '전체'],
                ['기본', '', '여름방학식', '', '', '', '전체'],
                ['기본', '', '여름방학', '', '', '', '전체'],
                ['기본', '', '2학기 개학일', '', '', '', '전체'],
                ['기본', '', '겨울방학식', '', '', '', '전체'],
                ['기본', '', '겨울방학', '', '', '', '전체'],
                ['기본', '', '봄 개학일', '', '', '', '전체'],
                ['기본', '', '봄방학식', '', '', '', '전체'],
                ['기본', '', '봄방학', '', '', '', '전체'],
                
                // 고사 일정 (범위)
                ['기본', '', '1학기 1차지필', '', '', '', '전체'],
                ['기본', '', '1학기 2차지필', '', '', '', '전체'],
                ['기본', '', '2학기 1차지필', '', '', '', '전체'],
                ['기본', '', '2학기 2차지필', '', '', '', '전체'],
                ['기본', '', '3학년 2학기 2차지필', '', '', '', '전체'],

                // 예시
                ['휴일', '', '대체공휴일', '2026-05-06', '2026-05-06', '', '전체'],
                ['일반', '교무기획부', '학부모총회', '2026-03-15', '2026-03-16', '강당', '전체']
            ];
            const ws = XLSX.utils.aoa_to_sheet(ws_data);
            XLSX.utils.book_append_sheet(wb, ws, '일정양식');
            XLSX.writeFile(wb, "학사일정_일괄등록_양식.xlsx");
        };

        // File Select & Parse
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            fileNameDisplay.textContent = file.name;
            
            // Read selected year when file changes (or ensure we read it on submit, but preview uses it for display if needed? 
            // Actually preview currently builds parsed data with year. So we must capture year here.)
            const selectedYear = parseInt(yearSelect.value);

            const reader = new FileReader();
            reader.onload = (evt) => {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to JSON
                const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                // Remove header row
                rawRows.shift();

                // Auto-Mapping Definition
                const titleMap = {
                    '1학기 개학일': { code: 'TERM1_START', type: 'term' },
                    '여름방학식': { code: 'SUMMER_VAC_CEREMONY', type: 'event' },
                    '여름방학': { code: 'SUMMER_VAC', type: 'vacation' }, // Range
                    '2학기 개학일': { code: 'TERM2_START', type: 'term' },
                    '겨울방학식': { code: 'WINTER_VAC_CEREMONY', type: 'event' },
                    '겨울방학': { code: 'WINTER_VAC', type: 'vacation' }, // Range
                    '봄 개학일': { code: 'SPRING_SEM_START', type: 'term' },
                    '봄방학식': { code: 'SPRING_VAC_CEREMONY', type: 'event' },
                    '봄방학': { code: 'SPRING_VAC', type: 'vacation' }, // Range
                    
                    // Exams (Range)
                    '1학기 1차지필': { code: 'EXAM_1_1', type: 'exam' },
                    '1학기 2차지필': { code: 'EXAM_1_2', type: 'exam' },
                    '2학기 1차지필': { code: 'EXAM_2_1', type: 'exam' },
                    '2학기 2차지필': { code: 'EXAM_2_2', type: 'exam' },
                    '3학년 2학기 2차지필': { code: 'EXAM_3_2_2', type: 'exam' }
                };

                const depts = this.state.departments; 
                parsedBasic = [];
                parsedNormal = [];
                let validCount = 0;
                let errors = [];

                // Use the year selected in dropdown
                const year = selectedYear; 

                rawRows.forEach((row, idx) => {
                    if (row.length < 3) return; // Skip empty rows
                    // Columns: 0:Type, 1:Dept, 2:Title, 3:Start, 4:End, 5:Desc, 6:Vis
                    const typeRaw = (row[0] || '').trim();
                    const deptName = (row[1] || '').trim();
                    const title = (row[2] || '').trim();
                    let start = row[3];
                    let end = row[4];
                    const desc = (row[5] || '').trim();
                    const visibilityRaw = (row[6] || '').trim();

                    if (!title || !start) {
                         // Only skip if completely empty
                         if(!typeRaw && !title && !start) return;
                         errors.push(`${idx+2}행: 필수 정보 누락 (일정명, 시작일)`);
                         return;
                    }
                    
                    if (typeRaw === '기본' || typeRaw === '휴일') {
                        // Check Auto-Mapping
                        const mapInfo = titleMap[title];
                        
                        if (mapInfo) {
                            // System Code Item
                            parsedBasic.push({
                                academic_year: year,
                                type: mapInfo.type,
                                code: mapInfo.code,
                                name: title,
                                start_date: start,
                                end_date: end || start, // Use merged date from row
                                is_holiday: false
                            });
                        } else {
                            // Standard Basic Event (No Code)
                            parsedBasic.push({
                                academic_year: year,
                                type: typeRaw === '휴일' ? 'holiday' : 'event', 
                                code: null,
                                name: title,
                                start_date: start,
                                end_date: end || start,
                                is_holiday: typeRaw === '휴일'
                            });
                        }
                        validCount++;
                    } else if (typeRaw === '일반') {
                         // Match Dept
                        const dept = depts.find(d => d.dept_name === deptName) || depts[0]; 

                        // Map Visibility
                        let visibility = 'internal';
                        if (visibilityRaw === '전체') visibility = 'public';
                        else if (visibilityRaw === '부서') visibility = 'dept';
                        
                        parsedNormal.push({
                            title,
                            start_date: start,
                            end_date: end || start,
                            description: desc || '',
                            dept_id: dept.id,
                            visibility,
                            author_id: this.state.user.id,
                            is_printable: true
                        });
                        validCount++;
                    } else {
                        errors.push(`${idx+2}행: 구분 값 오류 ('기본', '휴일', 또는 '일반' 입력)`);
                    }
                });
                
                
                
                previewCount.textContent = validCount;
                statusArea.classList.remove('hidden');
                
                // Show errors if any (Simple alert or list)
                if(errors.length > 0) {
                    alert('일부 데이터 오류:\n' + errors.slice(0, 5).join('\n') + (errors.length > 5 ? '\n...' : ''));
                }

                if (validCount > 0) {
                    btnUpload.disabled = false;
                }
            };
            reader.readAsArrayBuffer(file);
        };
        
        // Handle Year Change if file already selected? 
        // Simplest: clear file input if year changes, or re-parse.
        // Let's add listener to re-parse if file exists
        yearSelect.onchange = () => {
             if(fileInput.files.length > 0) {
                 // Trigger change event manually or extract logic
                 fileInput.dispatchEvent(new Event('change'));
             }
        };

        // Upload Action
        btnUpload.onclick = async () => {
             // Re-read selected year to be safe, though parsed data already has it embedded.
             // But showing it in alert is good.
             const selectedYear = yearSelect.value;
             
            if (parsedBasic.length === 0 && parsedNormal.length === 0) return;

            if(!confirm(`${selectedYear}학년도에 ${parsedBasic.length + parsedNormal.length}건의 일정을 등록하시겠습니까?`)) return;

            btnUpload.disabled = true;
            btnUpload.textContent = '업로드 중...';

            try {
                if(parsedBasic.length > 0) {
                    const { error: err1 } = await window.SupabaseClient.supabase
                        .from('basic_schedules')
                        .insert(parsedBasic);
                    if(err1) throw err1;
                }
                
                if(parsedNormal.length > 0) {
                    const { error: err2 } = await window.SupabaseClient.supabase
                        .from('schedules')
                        .insert(parsedNormal);
                     if(err2) throw err2;
                }
                
                this.logAction('BULK_INSERT', 'mixed', null, { basic: parsedBasic.length, normal: parsedNormal.length });
                alert(`총 ${parsedBasic.length + parsedNormal.length}건의 일정이 등록되었습니다.`);
                close();
                if (this.state.calendar) this.initCalendar();

            } catch (e) {
                console.error(e);
                alert('업로드 실패: ' + e.message);
                btnUpload.disabled = false;
                btnUpload.textContent = '업로드';
            }
        };
    },

    // --- Logging System ---

    fetchDepartments: async function () {
        const { data, error } = await window.SupabaseClient.supabase
            .from('departments')
            .select('*')
            .order('sort_order', { ascending: true });
            
        if (error) {
            console.error("fetchDepartments Error:", error);
            return [];
        }
        return data || [];
    },

    logAction: async function (action, table, targetId, details) {
        if (!this.state.user) return;

        // Fire and forget
        window.SupabaseClient.supabase.from('audit_logs').insert([{
            user_id: this.state.user.id,
            action_type: action,
            target_table: table,
            target_id: targetId,
            changes: JSON.stringify(details)
        }]).then(({ error }) => {
            if (error) console.error("Audit Log Error:", error);
        });
    },

    logError: async function (msg, url, line, col, errorObj) {
        const errDetails = {
            msg: msg,
            url: url,
            line: line,
            col: col,
            stack: errorObj?.stack
        };
        console.error("Capturing Client Error:", errDetails);

        window.SupabaseClient.supabase.from('error_logs').insert([{
            error_message: msg,
            stack_trace: JSON.stringify(errDetails),
            user_id: this.state.user?.id || null // Log user if known
        }]).then(({ error }) => {
            if (error) console.error("Failed to log error to DB:", error);
        });
    }
};

// Global Error Handler
window.onerror = function (msg, url, line, col, error) {
    if (window.App && window.App.logError) {
        window.App.logError(msg, url, line, col, error);
    }
    return false; // Let default handler run too
};

// Start Application
document.addEventListener('DOMContentLoaded', () => {
    window.App = App; // Expose for inline handlers
    App.init();
});

