const params = new URLSearchParams(location.search);
const stock = {
    code: params.get('code') || '',
    name: params.get('name') || '股票详情',
    date: params.get('date') || new Date().toISOString().slice(0, 10),
    price: Number(params.get('price')),
    currentPrice: Number(params.get('currentPrice')),
    change: Number(params.get('change')),
    days: params.get('days'),
    periodDays: params.get('periodDays'),
    volume: Number(params.get('volume'))
};
const chart = echarts.init(document.getElementById('detailChart'));
const typeNames = { daily: '日K走势', weekly: '周K走势', monthly: '月K走势' };
let chartRequestId = 0;

document.getElementById('stockName').textContent = stock.name;
document.getElementById('stockCode').textContent = stock.code;
document.getElementById('tradeDate').textContent = stock.date;
document.getElementById('closeButton').addEventListener('click', () => window.close());
document.getElementById('price').textContent = stock.price ? `¥${stock.price.toFixed(2)}` : '-';
document.getElementById('currentPrice').textContent = stock.currentPrice ? `¥${stock.currentPrice.toFixed(2)}` : '-';
document.getElementById('change').textContent = Number.isFinite(stock.change) && stock.change ? `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%` : '-';
document.getElementById('days').textContent = stock.days && stock.periodDays ? `${stock.periodDays}天${stock.days}板` : '暂无数据';
document.getElementById('amount').textContent = stock.volume ? `${(stock.volume * stock.price / 100000000).toFixed(2)}亿元` : '-';
document.getElementById('billboardLink').href = `https://data.eastmoney.com/stock/lhb,${stock.code.slice(2)}.html`;
document.getElementById('insightBoard').textContent = stock.days && stock.periodDays ? `${stock.periodDays}天${stock.days}板` : '暂无数据';
document.getElementById('insightChange').textContent = Number.isFinite(stock.change) ? `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%` : '-';
document.getElementById('insightAmount').textContent = stock.volume ? `${(stock.volume * stock.price / 100000000).toFixed(2)}亿元` : '-';
document.getElementById('thsLink').href = `https://stockpage.10jqka.com.cn/${stock.code.slice(2)}/`;
loadBillboard();

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelector('.tab.active').classList.remove('active');
        tab.classList.add('active');
        loadChart(tab.dataset.type);
    });
});

function eastmoneyCode() {
    return `${stock.code.startsWith('sh') ? '1' : '0'}.${stock.code.slice(2)}`;
}

async function loadChart(type) {
    const requestId = ++chartRequestId;
    setStatus('正在加载...');
    try {
        if (type === 'intraday') {
            const data = await loadIntraday();
            if (requestId !== chartRequestId) return;
            drawIntraday(data);
            document.getElementById('chartTitle').textContent = '分时走势';
        } else {
            const data = await loadKlines(type);
            if (requestId !== chartRequestId) return;
            drawKline(data, type);
            document.getElementById('chartTitle').textContent = typeNames[type];
        }
        setStatus(`更新于 ${new Date().toLocaleTimeString('zh-CN')}`);
    } catch (error) {
        setStatus(networkErrorMessage(error));
        chart.clear();
    }
}

function networkErrorMessage(error) {
    if (location.protocol === 'file:') return '请通过 HTTP 服务器打开页面（不要直接双击 HTML）';
    if (error.name === 'TypeError' || /Failed to fetch/i.test(error.message)) return '行情接口连接失败，请稍后重试';
    return error.message || '行情接口连接失败';
}

async function loadIntraday() {
    if (stock.date !== localDate()) throw new Error('历史日期暂无分时数据');
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${eastmoneyCode()}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
    const result = await fetch(url).then(response => response.json());
    const trends = result.data?.trends || [];
    if (!trends.length) throw new Error('暂无分时数据');
    return trends.map(item => {
        const values = item.split(',');
        return { time: values[0].slice(11), price: Number(values[1]), average: Number(values[2]), volume: Number(values[8]) || 0 };
    });
}

async function loadKlines(type) {
    const interval = { daily: 'day', weekly: 'week', monthly: 'month' }[type];
    const key = { daily: 'qfqday', weekly: 'qfqweek', monthly: 'qfqmonth' }[type];
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${stock.code},${interval},,,500,qfq`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const result = await fetch(url, { signal: controller.signal }).then(response => response.json()).finally(() => clearTimeout(timeout));
    const rows = (result.data?.[stock.code]?.[key] || []).filter(row => row[0] <= stock.date);
    if (!rows.length) throw new Error('暂无 K 线数据');
    const limit = { daily: 30, weekly: 20, monthly: 12 }[type];
    return rows.slice(-limit).map(item => {
        return {
            date: item[0],
            values: [Number(item[1]), Number(item[2]), Number(item[4]), Number(item[3])],
            volume: Number(item[5]) || 0
        };
    });
}

function drawIntraday(data) {
    const prices = data.map(item => item.price);
    const base = prices[0];
    const min = Math.min(...prices, ...data.map(item => item.average));
    const max = Math.max(...prices, ...data.map(item => item.average));
    const volumeValues = data.map(item => item.volume);
    chart.setOption({
        animation: false,
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: params => {
                const index = params[0].dataIndex;
                const item = data[index];
                return `${item.time}<br/>价格：¥${item.price.toFixed(2)}<br/>均价：¥${item.average.toFixed(2)}<br/>成交量：${item.volume.toLocaleString()} 手`;
            }
        },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        grid: [{ left: 58, right: 22, top: 22, height: '59%' }, { left: 58, right: 22, top: '72%', height: '18%' }],
        xAxis: [{ type: 'category', data: data.map(item => item.time), boundaryGap: false, axisLine: { lineStyle: { color: '#b8c0c7' } }, axisLabel: { interval: Math.max(1, Math.floor(data.length / 6)) } }, { type: 'category', gridIndex: 1, data: data.map(item => item.time), axisLabel: { show: false }, axisLine: { lineStyle: { color: '#b8c0c7' } } }],
        yAxis: [{ type: 'value', min: min - (max - min) * .1, max: max + (max - min) * .1, splitNumber: 4, axisLabel: { color: '#89929b' }, splitLine: { lineStyle: { color: '#edf0f2', type: 'dashed' } } }, { type: 'value', gridIndex: 1, name: '成交量(手)', nameTextStyle: { color: '#89929b', padding: [0, 0, 0, -28] }, axisLabel: { color: '#89929b', formatter: value => value >= 10000 ? `${(value / 10000).toFixed(1)}万` : value }, splitLine: { show: false } }],
        series: [{ name: '价格', type: 'line', data: prices, showSymbol: false, lineStyle: { color: '#d94b3f', width: 1.5 }, markLine: { symbol: 'none', label: { show: false }, lineStyle: { color: '#aeb7bf', type: 'dashed' }, data: [{ yAxis: base }] } }, { name: '均价', type: 'line', data: data.map(item => item.average), showSymbol: false, lineStyle: { color: '#e0a12b', width: 1 } }, { name: '成交量(手)', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 8, data: volumeValues, itemStyle: { color: (params) => { const index = params.dataIndex; return index === 0 || prices[index] >= prices[index - 1] ? '#d94b3f' : '#20a579'; } } }]
    }, true);
}

function drawKline(data, type) {
    const candleValues = data.map(item => item.values);
    chart.setOption({
        animation: false,
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: params => {
                const index = params[0].dataIndex;
                const item = data[index];
                return `${item.date}<br/>开盘：¥${item.values[0].toFixed(2)}<br/>收盘：¥${item.values[1].toFixed(2)}<br/>最高：¥${item.values[3].toFixed(2)}<br/>最低：¥${item.values[2].toFixed(2)}<br/>成交量：${item.volume.toLocaleString()} 手`;
            }
        },
        grid: [{ left: 58, right: 22, top: 22, height: '62%' }, { left: 58, right: 22, top: '76%', height: '14%' }],
        xAxis: [
            { type: 'category', data: data.map(item => item.date), axisLabel: { interval: Math.max(0, Math.floor(data.length / 6)) } },
            { type: 'category', gridIndex: 1, data: data.map(item => item.date), axisLabel: { show: false } }
        ],
        yAxis: [
            { type: 'value', scale: true, splitLine: { lineStyle: { color: '#edf0f2', type: 'dashed' } } },
            { type: 'value', gridIndex: 1, name: '成交量(手)', nameTextStyle: { color: '#89929b' }, axisLabel: { color: '#89929b', formatter: value => value >= 10000 ? `${(value / 10000).toFixed(1)}万` : value }, splitLine: { show: false } }
        ],
        series: [
            { name: 'K线', type: 'candlestick', data: candleValues, itemStyle: { color: '#d94b3f', color0: '#20a579', borderColor: '#d94b3f', borderColor0: '#20a579' } },
            { name: '成交量(手)', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 14, data: data.map((item, index) => ({ value: item.volume, itemStyle: { color: item.values[1] >= item.values[0] ? '#d94b3f' : '#20a579' } })) }
        ]
    }, true);
}

function localDate() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function setStatus(text) { document.getElementById('status').textContent = text; }
async function loadBillboard() {
    const filter = encodeURIComponent(`(TRADE_DATE='${stock.date}')(SECURITY_CODE="${stock.code.slice(2)}")`);
    const columns = 'SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLAIN,CLOSE_PRICE,CHANGE_RATE,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BILLBOARD_DEAL_AMT,ACCUM_AMOUNT,DEAL_NET_RATIO,DEAL_AMOUNT_RATIO,TURNOVERRATE';
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=${columns}&filter=${filter}&pageNumber=1&pageSize=50`;
    try {
        const result = await fetch(url).then(response => response.json());
        const item = result.result?.data?.[0];
        if (!item) {
            document.getElementById('billboardStatus').textContent = '当日未上榜';
            return;
        }
        document.getElementById('billboardReason').textContent = item.EXPLAIN || '上榜原因未提供';
        document.getElementById('billboardNet').textContent = formatAmount(item.BILLBOARD_NET_AMT);
        document.getElementById('billboardBuy').textContent = formatAmount(item.BILLBOARD_BUY_AMT);
        document.getElementById('billboardSell').textContent = formatAmount(item.BILLBOARD_SELL_AMT);
        document.getElementById('billboardStatus').textContent = '数据已更新';
    } catch (error) {
        document.getElementById('billboardStatus').textContent = '龙虎榜加载失败';
    }
}
function formatAmount(value) { return Number.isFinite(Number(value)) ? `${(Number(value) / 100000000).toFixed(2)}亿元` : '-'; }
window.addEventListener('resize', () => chart.resize());
loadChart('intraday');
