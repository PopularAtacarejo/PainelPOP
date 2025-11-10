// Gerenciamento de Modais
const Modals = {
    init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Fechar modais
        document.getElementById('close-modal').addEventListener('click', () => {
            this.hideCandidato();
        });

        document.getElementById('close-vaga-modal').addEventListener('click', () => {
            this.hideVaga();
        });

        document.getElementById('close-distancia-modal').addEventListener('click', () => {
            this.hideDistancia();
        });

        // Fechar modais ao clicar fora
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });
    },

    showCandidato(candidato) {
        const info = document.getElementById('candidato-info');
        info.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                <div>
                    <h3 style="color: var(--text); margin-bottom: 1rem;">Informações Pessoais</h3>
                    <div style="display: flex; flex-direction: column; gap: 0.8rem;">
                        <div><strong>Nome:</strong> ${candidato.nome}</div>
                        <div><strong>CPF:</strong> ${candidato.cpf}</div>
                        <div><strong>Email:</strong> ${candidato.email}</div>
                        <div><strong>Telefone:</strong> ${candidato.telefone}</div>
                    </div>
                </div>
                <div>
                    <h3 style="color: var(--text); margin-bottom: 1rem;">Endereço</h3>
                    <div style="display: flex; flex-direction: column; gap: 0.8rem;">
                        <div><strong>CEP:</strong> ${candidato.cep}</div>
                        <div><strong>Cidade:</strong> ${candidato.cidade}</div>
                        <div><strong>Bairro:</strong> ${candidato.bairro}</div>
                        <div><strong>Rua:</strong> ${candidato.rua}</div>
                        <div><strong>Transporte:</strong> <span class="badge ${candidato.transporte === 'Sim' ? 'badge-success' : 'badge-warning'}">${candidato.transporte}</span></div>
                    </div>
                </div>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <h3 style="color: var(--text); margin-bottom: 1rem;">Candidatura</h3>
                <div style="display: flex; flex-direction: column; gap: 0.8rem;">
                    <div><strong>Vaga:</strong> ${candidato.vaga}</div>
                    <div><strong>Data de Envio:</strong> ${Utils.formatarData(candidato.enviado_em)}</div>
                </div>
            </div>

            <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                ${candidato.arquivo_url ? `
                    <button class="btn btn-primary" onclick="window.open('${candidato.arquivo_url}', '_blank')">
                        <i class="fas fa-download"></i> Baixar Currículo
                    </button>
                ` : ''}
                <button class="btn btn-secondary" onclick="Curriculos.calcularDistanciaCandidato(${candidato.id})">
                    <i class="fas fa-route"></i> Calcular Distância
                </button>
            </div>
        `;

        document.getElementById('candidato-modal').style.display = 'flex';
    },

    hideCandidato() {
        document.getElementById('candidato-modal').style.display = 'none';
    },

    showVaga() {
        document.getElementById('vaga-modal').style.display = 'flex';
    },

    hideVaga() {
        document.getElementById('vaga-modal').style.display = 'none';
    },

    showDistancia(candidato, resultado) {
        const content = document.getElementById('distancia-content');
        const enderecoCandidato = `${candidato.rua}, ${candidato.bairro}, ${candidato.cidade}`;

        content.innerHTML = `
            <div style="text-align: center;">
                <h3 style="color: var(--accent); margin-bottom: 1.5rem;">
                    <i class="fas fa-route"></i> Distância do Candidato
                </h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                    <div style="background: var(--step-bg); padding: 1.5rem; border-radius: 10px;">
                        <div style="font-size: 0.9rem; color: var(--legend-text); margin-bottom: 0.5rem;">Distância</div>
                        <div style="font-size: 2rem; font-weight: 700; color: var(--accent);">${resultado.distancia}</div>
                    </div>
                    <div style="background: var(--step-bg); padding: 1.5rem; border-radius: 10px;">
                        <div style="font-size: 0.9rem; color: var(--legend-text); margin-bottom: 0.5rem;">Tempo Estimado</div>
                        <div style="font-size: 2rem; font-weight: 700; color: var(--accent);">${resultado.duracao}</div>
                    </div>
                </div>
                
                <div style="background: var(--step-bg); padding: 1.5rem; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 1rem;">
                    <div style="font-weight: 600; margin-bottom: 0.8rem; color: var(--text);">
                        <i class="fas fa-store"></i> Local do Mercado
                    </div>
                    <div style="color: var(--text);">Km 91, AL-220, 948 - Sen. Arnon de Melo, Arapiraca - AL</div>
                </div>
                
                <div style="background: var(--step-bg); padding: 1.5rem; border-radius: 10px; border: 1px solid var(--border);">
                    <div style="font-weight: 600; margin-bottom: 0.8rem; color: var(--text);">
                        <i class="fas fa-user"></i> Endereço do Candidato
                    </div>
                    <div style="color: var(--text);">${enderecoCandidato}</div>
                </div>
                
                <div style="margin-top: 1.5rem; padding: 1rem; background: color-mix(in srgb, var(--success-color) 15%, transparent); border-radius: 10px;">
                    <div style="font-size: 0.9rem; color: var(--success-color);">
                        <i class="fas fa-info-circle"></i> ${resultado.observacao}
                    </div>
                </div>
            </div>
        `;

        document.getElementById('distancia-modal').style.display = 'flex';
    },

    hideDistancia() {
        document.getElementById('distancia-modal').style.display = 'none';
    }
};

// Inicializar modais quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    Modals.init();
});
