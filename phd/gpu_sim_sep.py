import torch
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, FFMpegWriter
import os
import pickle

def run_sim_gpu(nx=256, ny=256, Re=20.0, Pr=10.0, Ec=0.1, Eu=1.0, presion_adversa=0.3, nt_steps=300, guardar_hist=False):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # Malla y discretización
    Lx_star = Ly_star = 1.0
    dx_star = Lx_star / (nx - 1)
    dy_star = Ly_star / (ny - 1)
    dt_cfl = 0.008 * dx_star
    nt = nt_steps if nt_steps else int(torch.ceil(torch.tensor(2.0 / dt_cfl)).item())
    dt_star = 1.0 / nt

    # Dominios
    x_star = torch.linspace(0, 1.0, nx, device=device)
    y_star = torch.linspace(0, 1.0, ny, device=device)
    X_star, Y_star = torch.meshgrid(x_star, y_star, indexing='ij')

    # Campos
    u = torch.ones((ny, nx), device=device)
    v = torch.zeros((ny, nx), device=device)
    p = torch.zeros((ny, nx), device=device)
    T = torch.ones((ny, nx), device=device)

    # Condiciones iniciales
    u[0, :] = -0.5
    u[-1, :] = 1.0
    T[0, :] = 0.0
    T[-1, :] = 0.0

    # Kernel de Laplace
    laplace_kernel = torch.tensor([[0, 1, 0],
                                   [1, -4, 1],
                                   [0, 1, 0]], dtype=torch.float32, device=device).unsqueeze(0).unsqueeze(0)

    # Historial
    hist_u, hist_v, hist_T = [], [], []

    for n in range(nt):
        u_lap = torch.nn.functional.conv2d(u.unsqueeze(0).unsqueeze(0), laplace_kernel, padding=1).squeeze()
        v_lap = torch.nn.functional.conv2d(v.unsqueeze(0).unsqueeze(0), laplace_kernel, padding=1).squeeze()
        T_lap = torch.nn.functional.conv2d(T.unsqueeze(0).unsqueeze(0), laplace_kernel, padding=1).squeeze()

        u[1:-1, 1:-1] += dt_star * (1 / Re) * u_lap[1:-1, 1:-1]
        v[1:-1, 1:-1] += dt_star * (1 / Re) * v_lap[1:-1, 1:-1]
        T[1:-1, 1:-1] += dt_star * (1 / (Re * Pr)) * T_lap[1:-1, 1:-1]

        # Fronteras
        u[0, :] = -0.5
        u[-1, :] = 1.0
        v[0, :] = 0
        v[-1, :] = 0
        T[0, :] = 0.0
        T[-1, :] = 0.0

        if guardar_hist and (n % (nt // 10) == 0 or n == nt - 1):
            hist_u.append(u.detach().cpu().numpy())
            hist_v.append(v.detach().cpu().numpy())
            hist_T.append(T.detach().cpu().numpy())

    return {
        "u": u.detach().cpu(),
        "v": v.detach().cpu(),
        "p": p.detach().cpu(),
        "T": T.detach().cpu(),
        "hist_u": hist_u,
        "hist_v": hist_v,
        "hist_T": hist_T,
        "params": {
            "nx": nx, "ny": ny, "nt": nt, "dt_star": dt_star,
            "Re": Re, "Pr": Pr, "Ec": Ec, "Eu": Eu,
            "presion_adversa": presion_adversa
        },
        "X_star": X_star.detach().cpu(),
        "Y_star": Y_star.detach().cpu()
    }

def animar_gpu_resultados(sim_data):
    X_star = sim_data["X_star"]
    Y_star = sim_data["Y_star"]
    u_hist = sim_data["u_history"]
    v_hist = sim_data["v_history"]
    p_hist = sim_data["p_history"]
    T_hist = sim_data["T_history"]
    tau_hist = sim_data["tau_history"]
    resolucion = X_star.shape[1]
    presion_adversa = sim_data["params"].get("presion_adversa", "N/A")

    fig, axs_grid = plt.subplots(3, 2, figsize=(12, 12))
    axs = axs_grid.flatten()

    titles = [
        'Velocidad |u*|',
        'Temperatura T*',
        'Presión p*',
        'Esfuerzo cortante τ*',
        'Componente u*',
        'Componente v*'
    ]
    cmaps = ['jet', 'jet', 'viridis', 'coolwarm', 'plasma', 'plasma']

    datasets = [
        np.sqrt(u_hist[0]**2 + v_hist[0]**2),
        T_hist[0],
        p_hist[0],
        tau_hist[0],
        u_hist[0],
        v_hist[0]
    ]

    for ax, title, cmap, data in zip(axs, titles, cmaps, datasets):
        cf = ax.contourf(X_star, Y_star, data, levels=20, cmap=cmap)
        ax.set_title(title)
        ax.set_xlabel("x*")
        ax.set_ylabel("y*")
        plt.colorbar(cf, ax=ax)

    t_star_0 = 0.0
    fig.suptitle(f"Resolución {resolucion}x{resolucion} | presión_adversa = {presion_adversa} | t* = {t_star_0:.2f}", fontsize=14)
    plt.tight_layout()

    def update(frame):
        t_star = frame / (len(u_hist) - 1)
        updated_data = [
            np.sqrt(u_hist[frame]**2 + v_hist[frame]**2),
            T_hist[frame],
            p_hist[frame],
            tau_hist[frame],
            u_hist[frame],
            v_hist[frame]
        ]
        for ax, data, cmap in zip(axs, updated_data, cmaps):
            for coll in list(ax.collections):
                coll.remove()
            ax.contourf(X_star, Y_star, data, levels=20, cmap=cmap)

        fig.suptitle(f"Resolución {resolucion}x{resolucion} | presión_adversa = {presion_adversa} | t* = {t_star:.2f}", fontsize=14)

        return axs

    anim = FuncAnimation(fig, update, frames=len(u_hist), interval=100, blit=False)
    return anim, fig



resoluciones = [25, 50, 100, 200, 400, 800, 1600]
resultados = {}

# Crear carpetas si no existen
carpeta_sim = "sim_gpu"
carpeta_anim = "anim_gpu"
os.makedirs(carpeta_sim, exist_ok=True)
os.makedirs(carpeta_anim, exist_ok=True)

for res in resoluciones:
    print(f"🔄 Simulando resolución {res}x{res}...")
    sim = run_sim_gpu(nx=res, ny=res, guardar_hist=True)
    resultados[f"{res}x{res}"] = sim

    # Guardar .pkl
    path_sim = os.path.join(carpeta_sim, f"{res}x{res}.pkl")
    with open(path_sim, 'wb') as f:
        pickle.dump(sim, f)
    print(f"💾 Datos guardados en {path_sim}")

    # Generar y guardar animación
    print(f"🎞️ Generando animación para {res}x{res}...")
    anim, fig = animar_gpu_resultados(sim)
    path_anim = os.path.join(carpeta_anim, f"{res}x{res}.mp4")
    anim.save(path_anim, writer=FFMpegWriter(fps=20))
    plt.close(fig)
    print(f"✅ Animación guardada en {path_anim}")
