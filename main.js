(function () {
    // --- 全局变量 ---
    let successChart = null;
    let failChart = null;
    let currentStats = {};
    let currentFailedStats = {};
    let currentStatsISO = {};
    let currentFailedStatsISO = {};
    let currentGasStats = {}; // gas fee by MM-DD (in SOL)
    let currentGasStatsISO = {}; // gas fee by YYYY-MM-DD (in SOL)
    let subscriptionId = null;
    let processedSignatures = new Set();
    let labels = [];
    const SOL_ADDRESS_BASE = "EAeFK7tGNKEurH8T5Kev3pg3tQgXAke5z5TeMZZQi7z9";

    let activeConnection = null;
    let currentAddress = '';
    let currentYear = new Date().getUTCFullYear();

    // 工具函数：获取 UTC 日期字符串 (格式: MM-DD)
    const getUTCDateStr = (date) => {
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${month}-${day}`;
    };

    // 延迟函数：实现sleep效果
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 根据日期字符串(MM-DD)获取UTC时间戳范围
    const getDateTimeRange = (dateStr) => {
        const year = currentYear;
        const [month, day] = dateStr.split('-');

        const startOfDayUTC = Date.UTC(year, parseInt(month) - 1, parseInt(day), 0, 0, 0, 0);
        const endOfDayUTC = Date.UTC(year, parseInt(month) - 1, parseInt(day), 23, 59, 59, 999);

        return {
            startTime: startOfDayUTC,
            endTime: endOfDayUTC
        };
    };
    async function getTransactionWithRetry(connection, signature, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const txDetail = await connection.getTransaction(signature, { commitment: 'confirmed' });
                return txDetail;
            } catch (e) {
                if (e.message && e.message.includes('429')) {
                    // 429错误：速率限制，使用指数退避
                    const waitTime = Math.pow(2, i) * 1000 + Math.random() * 1000;
                    console.log(`收到速率限制，等待 ${waitTime.toFixed(0)}ms 后重试...`);
                    await sleep(waitTime);
                } else {
                    console.log(`获取交易 ${signature.substring(0, 8)}... 失败:`, e.message);
                    return null;
                }
            }
        }
        return null;
    }

    // fee collection removed


    // --- 核心功能函数 ---
    async function fetchStats() {
        const address = document.getElementById('addressInput').value.trim();
        const btn = document.getElementById('btnText');
        const status = document.getElementById('status');
        const liveBadge = document.getElementById('liveBadge');

        if (!address) {
            alert("请输入有效的 Solana 地址");
            return;
        }

        localStorage.setItem('lastSolanaAddress', address);

        const RPC_URL = "https://skilled-warmhearted-lambo.solana-mainnet.quiknode.pro/5826f4b4bf51ad0344c9138d9bc752118d4f79a3/";
        const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');
        let pubKey;

        currentAddress = address;
        currentYear = new Date().getUTCFullYear();

        try {
            pubKey = new solanaWeb3.PublicKey(address);
        } catch (e) {
            alert("无效的地址格式");
            return;
        }

        // 移除旧监听
        if (subscriptionId !== null && activeConnection !== null) {
            try {
                await activeConnection.removeOnLogsListener(subscriptionId);
                console.log("旧监听器已移除");
            } catch (e) {
                console.error("注销监听失败:", e);
            }
            subscriptionId = null;
        }

        activeConnection = connection;
        processedSignatures.clear();
        currentStats = {};
        currentFailedStats = {};
        currentStatsISO = {};
        currentFailedStatsISO = {};
        currentGasStats = {};
        currentGasStatsISO = {};
        labels = [];
        liveBadge.classList.add('hidden');

        // 初始化 UTC 时间轴（过去两周）
        const now = new Date();
        const utcTodayZero = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
        const TWO_WEEKS_AGO = utcTodayZero - (13 * 24 * 60 * 60);

        for (let i = 13; i >= 0; i--) {
            const date = new Date((utcTodayZero - (i * 24 * 60 * 60)) * 1000);
            const dateStr = getUTCDateStr(date);
            labels.push(dateStr);
            currentStats[dateStr] = 0;
            currentFailedStats[dateStr] = 0;
            currentGasStats[dateStr] = 0;
        }

        btn.disabled = true;
        btn.innerText = "历史抓取中...";
        status.innerText = "正在获取最近两周的历史数据...";

        // 读取复选框：只有勾选时才获取当日的 gas 费用（此操作可能较慢）
        const fetchTodayGasCheckbox = document.getElementById('fetchTodayGas');
        const shouldFetchTodayGas = fetchTodayGasCheckbox ? fetchTodayGasCheckbox.checked : false;
        if (shouldFetchTodayGas) {
            status.innerText += ' 注意：已启用当日Gas费用抓取（可能较慢）。';
        }

        try {
            let lastSignature = null;
            let keepFetching = true;
            let count = 0;
            let todayTransactions = []; // 存储当天交易用于获取 gas 费用

            while (keepFetching) {
                const signatures = await connection.getSignaturesForAddress(pubKey, { limit: 1000, before: lastSignature });
                if (signatures.length === 0) break;

                for (let sig of signatures) {
                    // no longer stop at two weeks; collect full history (may be large)
                    const txDate = new Date(sig.blockTime * 1000);
                    const dateStr = getUTCDateStr(txDate);
                    const isoDate = new Date(sig.blockTime * 1000).toISOString().slice(0, 10);
                    const todayStr = getUTCDateStr(new Date());

                    if (sig.err === null) {
                        currentStats[dateStr] = (currentStats[dateStr] || 0) + 1;
                        currentStatsISO[isoDate] = (currentStatsISO[isoDate] || 0) + 1;
                    } else {
                        currentFailedStats[dateStr] = (currentFailedStats[dateStr] || 0) + 1;
                        currentFailedStatsISO[isoDate] = (currentFailedStatsISO[isoDate] || 0) + 1;
                    }

                    // 只在用户勾选时收集当天的交易用于获取 gas 费用
                    if (dateStr === todayStr && shouldFetchTodayGas) {
                        todayTransactions.push(sig);
                    }

                    processedSignatures.add(sig.signature);
                    count++;
                }

                lastSignature = signatures[signatures.length - 1].signature;
                if (count > 10000) break;
                status.innerText = `已获取 ${count} 笔历史交易...`;
            }

            // 获取当天交易的详情以计算 gas 费用
            if (todayTransactions.length > 0) {
                const todayStr = getUTCDateStr(new Date());
                const todayISO = new Date().toISOString().slice(0, 10);
                const todaySigArray = todayTransactions.map(s => s.signature);

                try {
                    // 严格限制批处理：每批 6 条，每批之间延迟 1.5 秒
                    // 这样平均请求速率约 4 请求/秒，远低于 15 请求/秒 的限制
                    const BATCH_SIZE = 6;
                    const BATCH_DELAY_MS = 1500; // 1.5 秒延迟

                    for (let i = 0; i < todaySigArray.length; i += BATCH_SIZE) {
                        const batch = todaySigArray.slice(i, Math.min(i + BATCH_SIZE, todaySigArray.length));

                        try {
                            status.innerText = `获取 gas 费用中... (${Math.min(i + BATCH_SIZE, todaySigArray.length)}/${todaySigArray.length})`;

                            const txDetails = await connection.getParsedTransactions(batch, {
                                maxSupportedTransactionVersion: 0,
                                commitment: 'confirmed'
                            });

                            txDetails.forEach((tx, index) => {
                                if (tx && tx.meta) {
                                    const gasSol = tx.meta.fee / 1000000000; // lamports to SOL
                                    currentGasStats[todayStr] = (currentGasStats[todayStr] || 0) + gasSol;
                                    currentGasStatsISO[todayISO] = (currentGasStatsISO[todayISO] || 0) + gasSol;
                                    console.log(`交易 ${batch[index].substring(0, 8)}... 的手续费为: ${gasSol} SOL`);
                                }
                            });
                        } catch (batchErr) {
                            console.warn(`获取第 ${Math.floor(i / BATCH_SIZE) + 1} 批交易失败: ${batchErr.message}`);
                        }

                        // 如果不是最后一批，延迟以避免 RPC 限流
                        if (i + BATCH_SIZE < todaySigArray.length) {
                            await sleep(BATCH_DELAY_MS);
                        }
                    }
                } catch (err) {
                    console.warn(`获取当天交易详情失败: ${err.message}`);
                }
            }

            renderChart();
            status.innerText = "监控中：实时同步已开启";
            liveBadge.classList.remove('hidden');

            // 实时监听
            subscriptionId = connection.onLogs(pubKey, (logs) => {
                if (processedSignatures.has(logs.signature)) return;
                processedSignatures.add(logs.signature);

                const nowUTC = new Date();
                const todayStr = getUTCDateStr(nowUTC);
                const todayISO = new Date(nowUTC.getTime()).toISOString().slice(0, 10);

                if (logs.err !== null) {
                    // 失败交易
                    currentFailedStats[todayStr] = (currentFailedStats[todayStr] || 0) + 1;
                    currentFailedStatsISO[todayISO] = (currentFailedStatsISO[todayISO] || 0) + 1;
                    console.log(`[实时] 收到失败交易: ${todayStr}`);
                    renderChart();
                } else {
                    // 成功交易
                    currentStats[todayStr] = (currentStats[todayStr] || 0) + 1;
                    currentStatsISO[todayISO] = (currentStatsISO[todayISO] || 0) + 1;
                    console.log(`[实时] 收到新交易: ${todayStr}`);
                    renderChart();
                }
            }, 'confirmed');

        } catch (err) {
            status.innerText = "错误: " + err.message;
        } finally {
            btn.disabled = false;
            btn.innerText = "开始分析";
        }
    }

    function renderChart() {
        const successCtx = document.getElementById('txChart').getContext('2d');
        const failCtx = document.getElementById('failChart')?.getContext('2d');
        const successData = labels.map(date => currentStats[date] || 0);
        const failData = labels.map(date => currentFailedStats[date] || 0);

        // 最近两周（labels）统计
        const totalSuccessRecent = successData.reduce((a, b) => a + b, 0);
        const totalFailedRecent = failData.reduce((a, b) => a + b, 0);
        const totalTxsRecent = totalSuccessRecent + totalFailedRecent;
        const successRateRecent = totalTxsRecent === 0 ? 0 : ((totalSuccessRecent / totalTxsRecent) * 100).toFixed(2);

        // 计算统计数据
        // 使用 ISO 日期数据计算：
        // - 连续活跃天数（从最近交易日开始往回的连续天数）
        // - 总交易笔数与成功率基于全部历史（ISO map）
        const allDatesSet = new Set();
        Object.entries(currentStatsISO).forEach(([iso, cnt]) => { if (cnt > 0) allDatesSet.add(iso); });
        Object.entries(currentFailedStatsISO).forEach(([iso, cnt]) => { if (cnt > 0) allDatesSet.add(iso); });

        let activeDays = 0;
        let lastInteractionDate = '-';
        if (allDatesSet.size > 0) {
            const isoDates = Array.from(allDatesSet).sort();
            const mostRecentISO = isoDates[isoDates.length - 1];
            // last interaction as MM-DD for display
            lastInteractionDate = getUTCDateStr(new Date(mostRecentISO + 'T00:00:00Z'));

            // 计算从最近日期开始的连续天数
            let streak = 0;
            let cursor = new Date(mostRecentISO + 'T00:00:00Z');
            while (true) {
                const iso = cursor.toISOString().slice(0, 10);
                if (allDatesSet.has(iso)) {
                    streak++;
                    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
                } else {
                    break;
                }
            }
            activeDays = streak;
        }

        const totalSuccess = Object.values(currentStatsISO).reduce((a, b) => a + b, 0);
        const totalFailed = Object.values(currentFailedStatsISO).reduce((a, b) => a + b, 0);
        const totalTxs = totalSuccess + totalFailed;
        const successRate = totalTxs === 0 ? 0 : ((totalSuccess / totalTxs) * 100).toFixed(2);

        // 更新统计卡片
        const statsContainer = document.getElementById('statsContainer');
        const todaySuccessTxsEl = document.getElementById('todaySuccessTxs');
        const todayGasSolEl = document.getElementById('todayGasSol');
        const todayGasCardEl = document.getElementById('todayGasCard');
        const fetchTodayGasCheckbox = document.getElementById('fetchTodayGas');
        const shouldShowGasCard = fetchTodayGasCheckbox ? fetchTodayGasCheckbox.checked : false;
        const activeDaysEl = document.getElementById('activeDays');
        const totalTxsEl = document.getElementById('totalTxs');

        const successTxsEl = document.getElementById('successTxs');
        const successRateEl = document.getElementById('successRate');
        const lastInteractionEl = document.getElementById('lastInteraction');

        // 计算当日成功交易笔数和 gas 费用（SOL）
        const nowUTC = new Date();
        const todayStr = getUTCDateStr(nowUTC);
        const todaySuccessTxs = currentStats[todayStr] || 0;
        const todayGasSol = currentGasStats[todayStr] || 0;

        const emptyState = document.getElementById('emptyState');
        if (totalTxsRecent > 0) {
            statsContainer.classList.remove('hidden');
            if (emptyState) emptyState.style.display = 'none';
        } else {
            statsContainer.classList.add('hidden');
            if (emptyState) emptyState.style.display = '';
        }

        if (todaySuccessTxsEl) todaySuccessTxsEl.innerText = todaySuccessTxs;
        if (todayGasSolEl) todayGasSolEl.innerText = todayGasSol.toFixed(4);
        if (activeDaysEl) activeDaysEl.innerText = activeDays;

        // 根据复选框决定当日Gas卡片是否显示，并调整卡片网格列数
        if (todayGasCardEl) {
            if (shouldShowGasCard) {
                todayGasCardEl.classList.remove('hidden');
                if (statsContainer) {
                    statsContainer.classList.remove('sm:grid-cols-6');
                    statsContainer.classList.add('sm:grid-cols-7');
                }
            } else {
                todayGasCardEl.classList.add('hidden');
                if (statsContainer) {
                    statsContainer.classList.remove('sm:grid-cols-7');
                    statsContainer.classList.add('sm:grid-cols-6');
                }
            }
        }
        if (totalTxsEl) totalTxsEl.innerText = totalTxsRecent;
        if (successTxsEl) successTxsEl.innerText = totalSuccessRecent;
        if (successRateEl) successRateEl.innerText = successRateRecent + '%';
        if (lastInteractionEl) lastInteractionEl.innerText = lastInteractionDate;

        // Success chart
        if (successChart) {
            successChart.data.labels = labels;
            successChart.data.datasets[0].data = successData;
            // update colors based on data values
            const maxSuccess = Math.max(1, ...successData);
            successChart.data.datasets[0].backgroundColor = successData.map(val => {
                const ratio = Math.min(1, val / Math.max(10, maxSuccess));
                const light = [219, 172, 245]; // light purple: rgb(219,172,245)
                const deep = [139, 92, 246];   // deep purple: rgb(139,92,246)
                const r = Math.floor(light[0] + (deep[0] - light[0]) * ratio);
                const g = Math.floor(light[1] + (deep[1] - light[1]) * ratio);
                const b = Math.floor(light[2] + (deep[2] - light[2]) * ratio);
                return `rgba(${r}, ${g}, ${b}, 0.8)`;
            });
            successChart.update('none');
        } else {
            successChart = new Chart(successCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '成功交易',
                        data: successData,
                        backgroundColor: successData.map(val => {
                            const maxSuccess = Math.max(1, ...successData);
                            const ratio = Math.min(1, val / Math.max(10, maxSuccess));
                            const light = [219, 172, 245];
                            const deep = [139, 92, 246];
                            const r = Math.floor(light[0] + (deep[0] - light[0]) * ratio);
                            const g = Math.floor(light[1] + (deep[1] - light[1]) * ratio);
                            const b = Math.floor(light[2] + (deep[2] - light[2]) * ratio);
                            return `rgba(${r}, ${g}, ${b}, 0.8)`;
                        }),
                        borderColor: 'rgb(139, 92, 246)',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    indexAxis: 'x',
                    scales: {
                        x: { stacked: false },
                        y: { beginAtZero: true, grace: '10%' }
                    },
                    plugins: {
                        datalabels: {
                            display: true,
                            anchor: 'end',
                            align: 'end',
                            offset: 5,
                            font: { weight: 'bold', size: 12 },
                            color: 'rgb(139, 92, 246)'
                        }
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const dateStr = labels[index];
                            const { startTime, endTime } = getDateTimeRange(dateStr);
                            const solscanUrl = `https://solscan.io/account/${currentAddress}?tab=transactions&time=${startTime}&time=${endTime}&status=success`;
                            window.open(solscanUrl, '_blank');
                        }
                    }
                },
                plugins: [{
                    id: 'customDataLabels',
                    afterDatasetsDraw(chart) {
                        const { ctx, chartArea: { left, top, width, height } } = chart;
                        chart.data.datasets.forEach((dataset, i) => {
                            const meta = chart.getDatasetMeta(i);
                            meta.data.forEach((datapoint, index) => {
                                const { x, y } = datapoint.getProps(['x', 'y']);
                                ctx.font = 'bold 12px sans-serif';
                                ctx.fillStyle = 'rgb(139, 92, 246)';
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'bottom';
                                ctx.fillText(dataset.data[index], x, y - 5);
                            });
                        });
                    }
                }]
            });
        }

        // Fail chart (separate)
        if (failCtx) {
            if (failChart) {
                failChart.data.labels = labels;
                failChart.data.datasets[0].data = failData;
                failChart.update('none');
            } else {
                failChart = new Chart(failCtx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: '失败交易',
                            data: failData,
                            backgroundColor: 'rgba(239, 68, 68, 0.8)',
                            borderColor: 'rgb(239, 68, 68)',
                            borderWidth: 1,
                            borderRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        indexAxis: 'x',
                        scales: {
                            x: { stacked: false },
                            y: { beginAtZero: true, grace: '10%' }
                        },
                        plugins: {
                            datalabels: {
                                display: true,
                                anchor: 'end',
                                align: 'end',
                                offset: 5,
                                font: { weight: 'bold', size: 12 },
                                color: 'rgb(239, 68, 68)'
                            }
                        },
                        onClick: (event, elements) => {
                            if (elements.length > 0) {
                                const index = elements[0].index;
                                const dateStr = labels[index];
                                const { startTime, endTime } = getDateTimeRange(dateStr);
                                const solscanUrl = `https://solscan.io/account/${currentAddress}?tab=transactions&time=${startTime}&time=${endTime}&status=failed`;
                                window.open(solscanUrl, '_blank');
                            }
                        }
                    },
                    plugins: [{
                        id: 'customDataLabels',
                        afterDatasetsDraw(chart) {
                            const { ctx, chartArea: { left, top, width, height } } = chart;
                            chart.data.datasets.forEach((dataset, i) => {
                                const meta = chart.getDatasetMeta(i);
                                meta.data.forEach((datapoint, index) => {
                                    const { x, y } = datapoint.getProps(['x', 'y']);
                                    ctx.font = 'bold 12px sans-serif';
                                    ctx.fillStyle = 'rgb(239, 68, 68)';
                                    ctx.textAlign = 'center';
                                    ctx.textBaseline = 'bottom';
                                    ctx.fillText(dataset.data[index], x, y - 5);
                                });
                            });
                        }
                    }]
                });
            }
        }

    }

    // --- 初始化 ---
    const init = () => {

        // A. 防御屏蔽逻辑
        // document.addEventListener('contextmenu', e => e.preventDefault());
        // document.addEventListener('keydown', e => {
        //     if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J'))) e.preventDefault();
        // });

        const analyzeBtn = document.getElementById('btnText');
        if (analyzeBtn) analyzeBtn.onclick = fetchStats;

        const addressInput = document.getElementById('addressInput');
        const urlParams = new URLSearchParams(window.location.search);
        const urlAddr = urlParams.get('addr');
        const savedAddress = localStorage.getItem('lastSolanaAddress');
        const finalAddr = urlAddr || savedAddress;

        if (finalAddr && addressInput) {
            addressInput.value = finalAddr;
            if (urlAddr) fetchStats();
        }

        // 打赏弹窗逻辑
        const dBtn = document.getElementById('donateBtn');
        const dModal = document.getElementById('donateModal');
        const cBtn = document.getElementById('closeDonate');
        if (dBtn && dModal) {
            dBtn.onclick = () => dModal.style.display = 'flex';
            cBtn.onclick = () => dModal.style.display = 'none';
            window.addEventListener('click', (e) => { if (e.target == dModal) dModal.style.display = 'none'; });
        }

        // 二维码生成
        const solFullUri = "solana:" + SOL_ADDRESS_BASE + "?amount=0.1&message=Support";
        const qrBox = document.getElementById("qrcode");
        if (qrBox) {
            new QRCode(qrBox, { text: solFullUri, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.H });
        }

        // 复制功能
        const copyBtn = document.getElementById('copyAddr');
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(SOL_ADDRESS_BASE).then(() => alert("地址已复制，感谢支持！"));
            };
        }

        // 当日Gas费复选框：根据勾选状态显示/隐藏当日Gas卡片，并调整卡片网格列数以均分剩余卡片
        const fetchTodayGasCheckbox = document.getElementById('fetchTodayGas');
        const todayGasCard = document.getElementById('todayGasCard');
        const statsContainerEl = document.getElementById('statsContainer');
        if (fetchTodayGasCheckbox && todayGasCard) {
            const updateGasCardVisibility = () => {
                const show = fetchTodayGasCheckbox.checked;
                if (show) {
                    todayGasCard.classList.remove('hidden');
                    if (statsContainerEl) {
                        statsContainerEl.classList.remove('sm:grid-cols-6');
                        statsContainerEl.classList.add('sm:grid-cols-7');
                    }
                } else {
                    todayGasCard.classList.add('hidden');
                    if (statsContainerEl) {
                        statsContainerEl.classList.remove('sm:grid-cols-7');
                        statsContainerEl.classList.add('sm:grid-cols-6');
                    }
                }
            };
            // 初始化可见性
            updateGasCardVisibility();
            // 监听用户切换
            fetchTodayGasCheckbox.addEventListener('change', updateGasCardVisibility);
        }
    };

    // --- 启动 ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(); // IIFE 结束