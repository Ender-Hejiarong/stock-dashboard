// 全局变量
let myChart = null;
let selectedStock = null;
let allStocks = [];
let stockDataCache = {};
let currentBoardFilter = 'all';

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeDateInput();
    refreshData();
    
    // 事件监听
    document.getElementById('dateInput').addEventListener('change', refreshData);
    document.getElementById('refreshBtn').addEventListener('click', refreshData);
    document.getElementById('boardFilters').addEventListener('click', event => {
        const button = event.target.closest('.board-filter');
        if (button) {
            currentBoardFilter = button.dataset.board;
            document.querySelectorAll('.board-filter').forEach(item => item.classList.remove('active'));
            button.classList.add('active');
            displayStockList(allStocks);
        }
    });
});

// 初始化日期输入框，默认为今天
function initializeDateInput() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    document.getElementById('dateInput').value = dateStr;
    document.getElementById('dateInput').max = dateStr;
}

function getLocalDate() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 刷新数据
async function refreshData() {
    const dateInput = document.getElementById('dateInput').value;
    updateTime();
    
    try {
        // 获取涨停股票列表
        const stocks = await fetchLimitUpStocks(dateInput);
        allStocks = stocks;
        
        displayStockList(stocks);
        enrichBoardStats(stocks, dateInput);
        
    } catch (error) {
        console.error('获取数据失败:', error);
        document.getElementById('stockCount').textContent = '不可用';
        document.getElementById('stockList').innerHTML = `<div class="loading">${escapeHtml(networkErrorMessage(error))}，未显示伪造数据。</div>`;
    }
}

function networkErrorMessage(error) {
    if (location.protocol === 'file:') return '请通过 HTTP 服务器打开页面（不要直接双击 HTML）';
    if (error.name === 'TypeError' || /Failed to fetch/i.test(error.message)) return '行情接口连接失败，请稍后重试';
    return error.message || '行情接口连接失败';
}

// 获取涨停股票列表
async function fetchLimitUpStocks(date) {
    const queryDate = date.replaceAll('-', '');
    const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=100&sort=fbt:asc&date=${queryDate}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`涨停池接口返回 ${response.status}`);
    const result = await response.json();
    const rows = (result.data?.pool || []).filter(row => Number(row.p) > 0);
    const stocks = [];
    for (let index = 0; index < rows.length; index += 5) {
        const batch = await Promise.all(rows.slice(index, index + 5).map(async row => {
            const code = `${row.m === 1 ? 'sh' : 'sz'}${row.c}`;
            const currentPrice = Number(row.p) / 1000;
            return {
                code,
                name: row.n,
                price: await fetchLimitPrice(code, row.n, currentPrice, Number(row.zdp)).catch(() => null),
                currentPrice,
                change: Number(row.zdp),
                volume: Number(row.amount) / currentPrice,
                days: null,
                periodDays: null,
                boardStatsPending: true
            };
        }));
        stocks.push(...batch);
    }
    return stocks;
}

async function fetchLimitPrice(code, name, currentPrice, change) {
    let previousClose;
    try {
        const result = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${getEastmoneyCode(code)}&fields=f43,f60`).then(response => response.json());
        previousClose = Number(result.data?.f60) / 100;
    } catch (_) {
        previousClose = currentPrice / (1 + change / 100);
    }
    if (!Number.isFinite(previousClose) || previousClose <= 0) return null;
    const threshold = getLimitUpThreshold(code, name);
    return Math.round(previousClose * (1 + threshold / 100) * 100) / 100;
}

async function enrichBoardStats(stocks, date) {
    displayStockList(stocks);
    const updated = await Promise.all(stocks.map(async stock => ({
        ...stock,
        boardStatsPending: false,
        ...await calculateBoardStats(stock, date)
    })));
    if (allStocks !== stocks) return;
    allStocks = updated;
    displayStockList(updated);
}

async function calculateBoardStats(stock, date) {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${stock.code},day,,,500,`;
    try {
        const result = await fetch(url).then(response => response.json());
        const rows = (result.data?.[stock.code]?.day || []).filter(row => row[0] <= date).slice(-30);
        const threshold = getLimitUpThreshold(stock.code, stock.name);
        const isLimitUp = rows.map((row, index) => {
            if (index === 0) return false;
            const previousClose = Number(rows[index - 1][2]);
            const close = Number(row[2]);
            return previousClose > 0 && (close - previousClose) / previousClose * 100 >= threshold - 0.15;
        });
        const latestIndex = isLimitUp.lastIndexOf(true);
        if (latestIndex < 0) return { days: null, periodDays: null };
        let firstIndex = latestIndex;
        let skippedDays = 0;
        let previousLimitUpFound = false;
        for (let index = latestIndex - 1; index >= 0; index--) {
            if (isLimitUp[index]) {
                firstIndex = index;
                previousLimitUpFound = true;
                continue;
            }
            skippedDays++;
            if (skippedDays > 1) break;
        }
        if (!previousLimitUpFound) return { days: 1, periodDays: 1 };
        return {
            days: isLimitUp.slice(firstIndex, latestIndex + 1).filter(Boolean).length,
            periodDays: latestIndex - firstIndex + 1
        };
    } catch (error) {
        console.error(`计算 ${stock.code} 连板统计失败:`, error);
        return {};
    }
}

function getLimitUpThreshold(code, name) {
    if (name.includes('ST')) return 5;
    const number = code.slice(2);
    if (number.startsWith('30') || number.startsWith('68')) return 20;
    if (number.startsWith('8') || number.startsWith('4')) return 30;
    return 10;
}

// 显示股票列表
function displayStockList(stocks) {
    const stockList = document.getElementById('stockList');
    const stockCount = document.getElementById('stockCount');

    const filteredStocks = stocks.filter(stock => {
        if (currentBoardFilter === 'all') return true;
        return Number(stock.days) === Number(currentBoardFilter);
    });
    stockCount.textContent = `${filteredStocks.length}只`;
    updateBoardFilterCounts(stocks);
    
    stockList.innerHTML = filteredStocks.map(stock => `
        <a class="stock-item" data-code="${stock.code}" href="${getStockDetailUrl(stock)}" target="_blank" rel="noopener noreferrer">
            <div class="stock-item-name">${escapeHtml(stock.name)}</div>
            <div class="stock-item-code">${escapeHtml(stock.code)}</div>
            <div class="stock-item-info">
                <span class="stock-item-price">涨停 ¥${Number.isFinite(stock.price) ? stock.price.toFixed(2) : '--'}<small>现价 ¥${stock.currentPrice.toFixed(2)}</small></span>
                <span class="stock-item-change">${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%</span>
                <span class="stock-item-days">${stock.periodDays && stock.days ? `${stock.periodDays}天${stock.days}板` : stock.boardStatsPending ? '统计中...' : '--'}</span>
            </div>
        </a>
    `).join('');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function updateBoardFilterCounts(stocks) {
    const counts = {};
    stocks.forEach(stock => {
        const days = Number(stock.days);
        if (Number.isInteger(days) && days > 0) counts[days] = (counts[days] || 0) + 1;
    });
    const filters = [`<button class="board-filter${currentBoardFilter === 'all' ? ' active' : ''}" data-board="all" role="tab">全部 (${stocks.length})</button>`];
    Object.keys(counts).sort((a, b) => Number(a) - Number(b)).forEach(board => {
        filters.push(`<button class="board-filter${currentBoardFilter === board ? ' active' : ''}" data-board="${board}" role="tab">${board}板 (${counts[board]})</button>`);
    });
    document.getElementById('boardFilters').innerHTML = filters.join('');
    const active = document.querySelector(`.board-filter[data-board="${currentBoardFilter}"]`);
    if (active) {
        active.classList.add('active');
    } else {
        currentBoardFilter = 'all';
        document.querySelector('.board-filter[data-board="all"]').classList.add('active');
    }
}

function getStockDetailUrl(stock) {
    const date = document.getElementById('dateInput').value;
    const params = new URLSearchParams({
        code: stock.code,
        name: stock.name,
        date,
        price: stock.price,
        currentPrice: stock.currentPrice,
        change: stock.change,
        days: stock.days || '',
        periodDays: stock.periodDays || '',
        volume: stock.volume || ''
    });
    return `stock_detail.html?${params.toString()}`;
}

// 选择股票
function selectStock(stock) {
    selectedStock = stock;
    
    // 高亮当前选择
    document.querySelectorAll('.stock-item').forEach(el => {
        el.classList.remove('active');
    });
    document.querySelector(`[data-code="${stock.code}"]`).classList.add('active');
    
    // 更新右侧显示信息
    document.getElementById('selectedStockName').textContent = stock.name;
    document.getElementById('selectedStockCode').textContent = stock.code;
    document.getElementById('currentPrice').textContent = `¥${stock.price.toFixed(2)}`;
    document.getElementById('priceChange').textContent = `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%`;
    document.getElementById('consecutiveDays').textContent = stock.days ? `${stock.days}连板` : '暂无数据';
    document.getElementById('volume').textContent = stock.volume ? `${(stock.volume / 10000).toFixed(2)}万股` : '--';
    
    // 更新图表
    updateChart();
}

// 更新图表
async function updateChart() {
    if (!selectedStock) return;
    
    const chartType = document.getElementById('chartType').value;
    const date = document.getElementById('dateInput').value;
    
    try {
        let data;
        
        if (chartType === 'intraday') {
            data = await fetchIntradayData(selectedStock.code, date);
            drawIntradayChart(data, selectedStock.name);
        } else {
            data = await fetchCandleData(selectedStock.code, chartType, date);
            drawCandleChart(data, selectedStock.name, chartType);
        }
    } catch (error) {
        console.error('更新图表失败:', error);
    }
}

function getEastmoneyCode(code) {
    return `${code.startsWith('sh') ? '1' : '0'}.${code.slice(2)}`;
}

async function fetchIntradayData(code, date) {
    const today = getLocalDate();
    if (date !== today) throw new Error('历史分时数据暂不可查询，请切换到当日');
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${getEastmoneyCode(code)}&fields1=f1,f2,f3&fields2=f51,f52`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`分时接口返回 ${response.status}`);
    const result = await response.json();
    return (result.data?.trends || []).map(item => {
        const [time, price] = item.split(',');
        return [time.slice(11), Number(price).toFixed(2)];
    });
}

async function fetchCandleData(code, type, date) {
    const period = { daily: 101, weekly: 102, monthly: 103 }[type];
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    const end = endDate.toISOString().slice(0, 10).replaceAll('-', '');
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${getEastmoneyCode(code)}&klt=${period}&fqt=1&beg=19900101&end=${end}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`K线接口返回 ${response.status}`);
    const result = await response.json();
    const limit = { daily: 30, weekly: 20, monthly: 12 }[type];
    return (result.data?.klines || []).slice(-limit).map(item => {
        const values = item.split(',');
        return { date: values[0], values: [values[1], values[2], values[4], values[3]].map(Number) };
    });
}

// 画分时图
function drawIntradayChart(data, stockName) {
    const times = data.map(d => d[0]);
    const prices = data.map(d => parseFloat(d[1]));
    
    const option = {
        title: {
            text: `${stockName} - 分时图`,
            left: 'center'
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(50, 50, 50, 0.7)',
            borderColor: '#333',
            textStyle: { color: '#fff' },
            formatter: function(params) {
                if (params.length > 0) {
                    const param = params[0];
                    return `${param.name}<br/>价格: ¥${param.value}`;
                }
            }
        },
        xAxis: {
            type: 'category',
            data: times,
            boundaryGap: false,
            axisLine: { lineStyle: { color: '#ddd' } }
        },
        yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: '#ddd' } },
            splitLine: { lineStyle: { color: '#eee' } }
        },
        series: [
            {
                name: '价格',
                data: prices,
                type: 'line',
                smooth: true,
                lineStyle: { color: '#667eea', width: 2 },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(102, 126, 234, 0.3)' },
                        { offset: 1, color: 'rgba(102, 126, 234, 0)' }
                    ])
                },
                itemStyle: { color: '#667eea' },
                smooth: true
            }
        ],
        grid: {
            top: 50,
            left: 60,
            right: 30,
            bottom: 40
        }
    };
    
    myChart.setOption(option);
}

// 画K线图
function drawCandleChart(data, stockName, type) {
    const dates = [];
    const typeMap = {
        daily: '日',
        weekly: '周',
        monthly: '月'
    };
    
    for (let i = 0; i < data.length; i++) {
        dates.push(data[i].date);
    }
    
    const option = {
        title: {
            text: `${stockName} - ${typeMap[type]}K线图`,
            left: 'center'
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(50, 50, 50, 0.7)',
            borderColor: '#333',
            textStyle: { color: '#fff' },
            formatter: function(params) {
                if (params.length > 0) {
                    const param = params[0];
                    const value = param.value;
                    return `${param.name}<br/>开: ¥${value[0]}<br/>收: ¥${value[1]}<br/>低: ¥${value[2]}<br/>高: ¥${value[3]}`;
                }
            }
        },
        xAxis: {
            type: 'category',
            data: dates,
            axisLine: { lineStyle: { color: '#ddd' } }
        },
        yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: '#ddd' } },
            splitLine: { lineStyle: { color: '#eee' } }
        },
        series: [
            {
                name: '股价',
                data: data.map(item => item.values),
                type: 'candlestick',
                itemStyle: {
                    color: '#f56c6c',        // 上升时的颜色（红色）
                    color0: '#16c784',       // 下降时的颜色（绿色）
                    borderColor: '#f56c6c',
                    borderColor0: '#16c784'
                }
            }
        ],
        grid: {
            top: 50,
            left: 60,
            right: 30,
            bottom: 40
        }
    };
    
    myChart.setOption(option);
}

// 更新时间显示
function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN');
    document.getElementById('updateTime').textContent = timeStr;
}

// 响应式处理
window.addEventListener('resize', function() {
    if (myChart) {
        myChart.resize();
    }
});

// 定期刷新（可选，每5分钟刷新一次）
// setInterval(refreshData, 5 * 60 * 1000);
