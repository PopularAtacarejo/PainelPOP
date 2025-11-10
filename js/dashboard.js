// Gerenciamento do Dashboard
const Dashboard = {
    charts: {},
    
    async load() {
        try {
            const stats = await API.call('/api/admin/stats');
            this.updateMetrics(stats);
            this.renderCharts(stats);
        } catch (error) {
            console.error('Erro ao carregar dashboard:', error);
            alert('Erro ao carregar dashboard: ' + error.message);
        }
    },

    updateMetrics(stats) {
        document.getElementById('total-candidaturas').textContent = 
            Utils.formatarNumero(stats.total);
        
        if (stats.porVaga.length > 0) {
            const vagaPopular = stats.porVaga[0];
            document.getElementById('vaga-popular').textContent = 
                vagaPopular.vaga.length > 15 ? vagaPopular.vaga.substring(0, 15) + '...' : vagaPopular.vaga;
            document.getElementById('count-vaga-popular').textContent = 
                `${Utils.formatarNumero(vagaPopular.count)} candidaturas`;
        }
        
        document.getElementById('candidatos-arapiraca').textContent = 
            Utils.formatarNumero(stats.arapiraca);
        
        const percentualArapiraca = stats.total > 0 ? 
            Math.round((stats.arapiraca / stats.total) * 100) : 0;
        document.getElementById('percentual-arapiraca').textContent = 
            `${percentualArapiraca}% do total`;

        // Calcular taxa de transporte
        const totalTransporte = stats.porTransporte.reduce((acc, item) => acc + item.count, 0);
        const comTransporte = stats.porTransporte.find(item => item.transporte === 'Sim')?.count || 0;
        const taxaTransporte = totalTransporte > 0 ? 
            Math.round((comTransporte / totalTransporte) * 100) : 0;
        document.getElementById('taxa-transporte').textContent = `${taxaTransporte}%`;
    },

    renderCharts(stats) {
        this.renderVagasChart(stats);
        this.renderCidadesChart(stats);
        this.renderEvolucaoChart(stats);
        this.renderTransporteChart(stats);
    },

    renderVagasChart(stats) {
        const ctx = document.getElementById('chart-vagas').getContext('2d');
        
        if (this.charts.vagas) {
            this.charts.vagas.destroy();
        }
        
        this.charts.vagas = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: stats.porVaga.slice(0, 8).map(item => 
                    item.vaga.length > 12 ? item.vaga.substring(0, 12) + '...' : item.vaga
                ),
                datasets: [{
                    label: 'Candidaturas',
                    data: stats.porVaga.slice(0, 8).map(item => item.count),
                    backgroundColor: '#059669',
                    borderColor: '#047857',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    },

    renderCidadesChart(stats) {
        const ctx = document.getElementById('chart-cidades').getContext('2d');
        
        if (this.charts.cidades) {
            this.charts.cidades.destroy();
        }
        
        this.charts.cidades = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: stats.porCidade.slice(0, 6).map(item => item.cidade),
                datasets: [{
                    data: stats.porCidade.slice(0, 6).map(item => item.count),
                    backgroundColor: [
                        '#059669', '#10b981', '#34d399', '#065f46', '#047857', '#a7f3d0'
                    ]
                }]
            }
        });
    },

    renderEvolucaoChart(stats) {
        const ctx = document.getElementById('chart-evolucao').getContext('2d');
        
        if (this.charts.evolucao) {
            this.charts.evolucao.destroy();
        }
        
        this.charts.evolucao = new Chart(ctx, {
            type: 'line',
            data: {
                labels: stats.evolucao.map(item => item.data.split('/')[0]),
                datasets: [{
                    label: 'Candidaturas',
                    data: stats.evolucao.map(item => item.count),
                    backgroundColor: 'rgba(5, 150, 105, 0.2)',
                    borderColor: '#059669',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    },

    renderTransporteChart(stats) {
        const ctx = document.getElementById('chart-transporte').getContext('2d');
        
        if (this.charts.transporte) {
            this.charts.transporte.destroy();
        }
        
        this.charts.transporte = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: stats.porTransporte.map(item => item.transporte),
                datasets: [{
                    data: stats.porTransporte.map(item => item.count),
                    backgroundColor: ['#059669', '#ef4444']
                }]
            }
        });
    }
};
