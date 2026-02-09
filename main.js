(function () {
    // --- 1. 全局变量（现在被包裹在私有作用域内，外部无法访问） ---
    let myChart = null;
    let currentStats = {};
    let subscriptionId = null;
    let processedSignatures = new Set();
    const SOL_ADDRESS_BASE = "EAeFK7tGNKEurH8T5Kev3pg3tQgXAke5z5TeMZZQi7z9";

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

        const RPC_URL = "https://mainnet.helius-rpc.com/?api-key=401bf178-3c34-4f65-a0d1-bfdbeb9d3899";
        const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');
        let pubKey = new solanaWeb3.PublicKey(address);

        if (subscriptionId !== null) {
            try { await connection.removeOnLogsListener(subscriptionId); } catch (e) { }
            subscriptionId = null;
        }
        processedSignatures.clear();
        liveBadge.classList.add('hidden');

        const TWO_WEEKS_AGO = Math.floor(Date.now() / 1000) - (14 * 24 * 60 * 60);
        btn.disabled = true;
        btn.innerText = "历史抓取中...";
        status.innerText = "正在获取最近两周的历史数据...";
        currentStats = {};

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
                        const date = new Date(sig.blockTime * 1000).toLocaleDateString('zh-CN');
                        currentStats[date] = (currentStats[date] || 0) + 1;
                        processedSignatures.add(sig.signature);
                        count++;
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
                const today = new Date().toLocaleDateString('zh-CN');
                currentStats[today] = (currentStats[today] || 0) + 1;
                renderChart();
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
        const chartData = Object.entries(currentStats)
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => new Date(a.date.replace(/\//g, '-')) - new Date(b.date.replace(/\//g, '-')));

        if (myChart) {
            myChart.data.labels = chartData.map(d => d.date);
            myChart.data.datasets[0].data = chartData.map(d => d.count);
            myChart.update('none');
            return;
        }

        myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartData.map(d => d.date),
                datasets: [{
                    label: '交易笔数',
                    data: chartData.map(d => d.count),
                    backgroundColor: 'rgba(139, 92, 246, 0.6)',
                    borderColor: 'rgb(139, 92, 246)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                animation: {
                    onComplete: function () {
                        const cInstance = this; const c = cInstance.ctx;
                        c.font = 'bold 10px monospace'; c.fillStyle = "#7c3aed"; c.textAlign = 'center';
                        this.data.datasets.forEach(function (ds, i) {
                            cInstance.getDatasetMeta(i).data.forEach(function (bar, idx) {
                                c.fillText(ds.data[idx], bar.x, bar.y - 5);
                            });
                        });
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