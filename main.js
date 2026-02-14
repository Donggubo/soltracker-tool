(function () {
    // --- 1. 全局变量（现在被包裹在私有作用域内，外部无法访问） ---
    let myChart = null;
    let currentStats = {};
    let subscriptionId = null;
    let processedSignatures = new Set();
    let labels = []; // 提升为全局，确保渲染和统计使用同一套坐标轴
    const SOL_ADDRESS_BASE = "EAeFK7tGNKEurH8T5Kev3pg3tQgXAke5z5TeMZZQi7z9";

    // 新增：记录当前活跃的连接对象，确保销毁时能对上号
    let activeConnection = null;

    // 工具函数：获取 UTC 日期字符串 (格式: MM-DD)
    const getUTCDateStr = (date) => {
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${month}-${day}`;
    };


    // --- 2. 核心功能函数 ---
    async function fetchStats() {
        const address = document.getElementById('addressInput').value.trim();
        const btn = document.getElementById('btnText');
        const status = document.getElementById('status');
        const liveBadge = document.getElementById('liveBadge');

        if (!address) {
            alert("请输入有效的 Solana 地址");
            return;
        }

        // --- 新增：保存有效地址到 localStorage ---
        localStorage.setItem('lastSolanaAddress', address);

        const RPC_URL = "https://skilled-warmhearted-lambo.solana-mainnet.quiknode.pro/5826f4b4bf51ad0344c9138d9bc752118d4f79a3/";
        // const RPC_URL = "https://mainnet.helius-rpc.com/?api-key=401bf178-3c34-4f65-a0d1-bfdbeb9d3899";
        const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');
        let pubKey;

        try {
            pubKey = new solanaWeb3.PublicKey(address);
        }catch (e) {
            alert("无效的地址格式");
            return;
        }
        // --- 核心修复：彻底销毁旧监听 ---
        if (subscriptionId !== null && activeConnection !== null) {
            try {
                // 必须使用【创建该订阅时】的那个 connection 对象来移除
                await activeConnection.removeOnLogsListener(subscriptionId);
                console.log("旧监听器已彻底移除");
            } catch (e) {
                console.error("注销监听失败:", e);
            }
            subscriptionId = null;
        }
        activeConnection = connection; // 更新当前活跃连接
        processedSignatures.clear();
        currentStats = {};
        labels = [];
        liveBadge.classList.add('hidden');

        // --- C. 初始化 UTC 时间轴 ---
        const now = new Date();
        // 获取 UTC 今天的 0 点时间戳
        const utcTodayZero = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
        const TWO_WEEKS_AGO = utcTodayZero - (13 * 24 * 60 * 60);

        for (let i = 13; i >= 0; i--) {
            const date = new Date((utcTodayZero - (i * 24 * 60 * 60)) * 1000);
            const dateStr = getUTCDateStr(date);
            labels.push(dateStr);
            currentStats[dateStr] = 0; // 预填充 0，保证图表完整
        }

        btn.disabled = true;
        btn.innerText = "历史抓取中...";
        status.innerText = "正在获取最近两周的历史数据...";

        try {
            let lastSignature = null;
            let keepFetching = true;
            let count = 0;

            while (keepFetching) {
                const signatures = await connection.getSignaturesForAddress(pubKey, { limit: 1000, before: lastSignature });
                if (signatures.length === 0) break;

                for (let sig of signatures) {
                    if (sig.blockTime < TWO_WEEKS_AGO) { keepFetching = false; break; }
                    if (sig.err === null) {

                        // 使用 UTC 格式化日期
                        const txDate = new Date(sig.blockTime * 1000);
                        const dateStr = getUTCDateStr(txDate);

                        if (currentStats[dateStr] !== undefined) {
                            currentStats[dateStr]++;
                        }
                        processedSignatures.add(sig.signature);
                        count++;

                        // const date = new Date(sig.blockTime * 1000).toLocaleDateString('zh-CN');
                        // currentStats[date] = (currentStats[date] || 0) + 1;
                        // processedSignatures.add(sig.signature);
                        // count++;
                    }
                }
                lastSignature = signatures[signatures.length - 1].signature;
                if (count > 10000) break;
                status.innerText = `已获取 ${count} 笔历史交易...`;
            }

            renderChart();
            status.innerText = "监控中：实时同步已开启";
            liveBadge.classList.remove('hidden');

            subscriptionId = connection.onLogs(pubKey, (logs) => {
                if (logs.err !== null || processedSignatures.has(logs.signature)) return;
                processedSignatures.add(logs.signature);

                const nowUTC = new Date();
                const todayStr = getUTCDateStr(nowUTC);

                if (currentStats[todayStr] !== undefined) {
                    currentStats[todayStr]++;
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
        const ctx = document.getElementById('txChart').getContext('2d');
        // 直接使用有序的 labels 映射数据，彻底解决排序混乱问题
        const dataValues = labels.map(date => currentStats[date] || 0);

        if (myChart) {
            myChart.data.labels = labels;
            myChart.data.datasets[0].data = dataValues;
            myChart.update('none');
            return;
        }

        myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '交易笔数',
                    data: dataValues,
                    backgroundColor: 'rgba(139, 92, 246, 0.6)',
                    borderColor: 'rgb(139, 92, 246)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                // 解决实时更新时数字显示的核心逻辑
                animation: {
                    onComplete: function() {
                        const chartInstance = this;
                        const c = chartInstance.ctx;
                        c.font = 'bold 12px monospace';
                        c.fillStyle = "#7c3aed";
                        c.textAlign = 'center';
                        c.textBaseline = 'bottom';

                        this.data.datasets.forEach(function(dataset, i) {
                            const meta = chartInstance.getDatasetMeta(i);
                            meta.data.forEach(function(bar, index) {
                                const data = dataset.data[index];
                                // 在柱子顶部上方 5 像素处绘制文字
                                c.fillText(data, bar.x, bar.y - 5);
                            });
                        });
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        // 预留顶部空间给数字，防止数字被遮挡
                        grace: '10%'
                    }
                }
            }
        });
    }

    // --- 3. Init 初始化方法（负责所有的绑定） ---
    const init = () => {
        // A. 防御屏蔽逻辑
        document.addEventListener('contextmenu', e => e.preventDefault());
        document.addEventListener('keydown', e => {
            if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J'))) e.preventDefault();
        });

        // B. 分析按钮绑定
        const analyzeBtn = document.getElementById('btnText');
        if (analyzeBtn) analyzeBtn.onclick = fetchStats;

        // --- 新增：从 localStorage 读取地址 ---
        const addressInput = document.getElementById('addressInput');

        // 1. 优先尝试从 URL 获取参数 (?addr=xxx)
        const urlParams = new URLSearchParams(window.location.search);
        const urlAddr = urlParams.get('addr');

        // 2. 其次尝试从 localStorage 获取
        const savedAddress = localStorage.getItem('lastSolanaAddress');

        const finalAddr = urlAddr || savedAddress;

        if (finalAddr && addressInput) {
            addressInput.value = finalAddr;
            // 如果是从 URL 进来的，建议直接触发分析
            if (urlAddr) fetchStats();
        }

        // C. 打赏弹窗逻辑
        const dBtn = document.getElementById('donateBtn');
        const dModal = document.getElementById('donateModal');
        const cBtn = document.getElementById('closeDonate');
        if (dBtn && dModal) {
            dBtn.onclick = () => dModal.style.display = 'flex';
            cBtn.onclick = () => dModal.style.display = 'none';
            window.addEventListener('click', (e) => { if (e.target == dModal) dModal.style.display = 'none'; });
        }

        // D. 二维码生成逻辑
        const solFullUri = "solana:" + SOL_ADDRESS_BASE + "?amount=0.1&message=Support";
        const qrBox = document.getElementById("qrcode");
        if (qrBox) {
            new QRCode(qrBox, { text: solFullUri, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.H });
        }

        // E. 复制功能
        const copyBtn = document.getElementById('copyAddr');
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(SOL_ADDRESS_BASE).then(() => alert("地址已复制，感谢支持！"));
            };
        }
    };

    // --- 4. 立即启动总开关 ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(); // IIFE 结束