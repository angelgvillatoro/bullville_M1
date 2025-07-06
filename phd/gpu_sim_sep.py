import torch
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, FFMpegWriter
import os
import pickle

def actualizar_campos_gpu(presion_adversa, u, v, p, T, Re, Pr, Ec, Eu, dt_star, dx_star, dy_star):
    ny, nx = u.shape

    device = u.device
    u_new = u.clone()
    v_new = v.clone()
    p_new = p.clone()
    T_new = T.clone()

    # --- CONVECTION + DIFFUSION ---
    u_x = (u[:, 2:] - u[:, :-2]) / (2 * dx_star)
    u_y = (u[2:, :] - u[:-2, :]) / (2 * dy_star)
    v_x = (v[:, 2:] - v[:, :-2]) / (2 * dx_star)
    v_y = (v[2:, :] - v[:-2, :]) / (2 * dy_star)

    u_lap = (u[:, 2:] - 2 * u[:, 1:-1] + u[:, :-2]) / dx_star**2 + \
            (u[2:, 1:-1] - 2 * u[1:-1, 1:-1] + u[:-2, 1:-1]) / dy_star**2

    v_lap = (v[:, 2:] - 2 * v[:, 1:-1] + v[:, :-2]) / dx_star**2 + \
            (v[2:, 1:-1] - 2 * v[1:-1, 1:-1] + v[:-2, 1:-1]) / dy_star**2

    u_conv = u[1:-1, 1:-1] * u_x[1:-1, :] + v[1:-1, 1:-1] * u_y[:, 1:-1]
    v_conv = u[1:-1, 1:-1] * v_x[1:-1, :] + v[1:-1, 1:-1] * v_y[:, 1:-1]

    u_new[1:-1, 1:-1] += dt_star * (-u_conv + (1/Re) * u_lap)
    v_new[1:-1, 1:-1] += dt_star * (-v_conv + (1/Re) * v_lap)

    # --- PRESIÓN ---
    for _ in range(20):
        div = (u_new[:, 2:] - u_new[:, :-2]) / (2 * dx_star) + \
              (v_new[2:, :] - v_new[:-2, :]) / (2 * dy_star)

        p_new[1:-1, 1:-1] = 0.25 * (p[1:-1, 2:] + p[1:-1, :-2] +
                                   p[2:, 1:-1] + p[:-2, 1:-1] -
                                   (dx_star * dy_star) / (2 * (dx_star**2 + dy_star**2)) * div)

    # --- GRADIENTE DE PRESIÓN EXTERNA ---
    x_vals = torch.linspace(0, 1.0, nx, device=device)
    for j in range(nx):
        x = x_vals[j]
        if x > 0.3:
            p_new[:, j] += presion_adversa * (x - 0.3)
        else:
            p_new[:, j] += 0.01

    # --- CORRECCIÓN POR GRADIENTE DE PRESIÓN ---
    dpdx = (p_new[:, 2:] - p_new[:, :-2]) / (2 * dx_star)
    dpdy = (p_new[2:, :] - p_new[:-2, :]) / (2 * dy_star)

    u_new[1:-1, 1:-1] -= dt_star * Eu * dpdx[1:-1, :]
    v_new[1:-1, 1:-1] -= dt_star * Eu * dpdy[:, 1:-1]

    # --- TEMPERATURA ---
    T_x = (T[:, 2:] - T[:, :-2]) / (2 * dx_star)
    T_y = (T[2:, :] - T[:-2, :]) / (2 * dy_star)
    T_lap = (T[:, 2:] - 2 * T[:, 1:-1] + T[:, :-2]) / dx_star**2 + \
             (T[2:, 1:-1] - 2 * T[1:-1, 1:-1] + T[:-2, 1:-1]) / dy_star**2

    # Gradientes de velocidad para calentamiento viscoso
    Sxx = (u_new[:, 2:] - u_new[:, :-2]) / (2 * dx_star)
    Syy = (v_new[2:, :] - v_new[:-2, :]) / (2 * dy_star)
    Sxy = 0.5 * ((u_new[2:, 1:-1] - u_new[:-2, 1:-1]) / (2 * dy_star) +
                (v_new[1:-1, 2:] - v_new[1:-1, :-2]) / (2 * dx_star))

    viscous = (Ec / Re) * (2 * (Sxx**2 + Syy**2) + 4 * Sxy**2)

    T_new[1:-1, 1:-1] += dt_star * (-u[1:-1, 1:-1] * T_x[1:-1, :] - v[1:-1, 1:-1] * T_y[:, 1:-1] +
                                   (1 / (Re * Pr)) * T_lap + viscous)

    # --- SHEAR STRESS ---
    tau = (u_new[2:, :] - u_new[:-2, :]) / (2 * dy_star)
    tau_full = torch.zeros_like(u)
    tau_full[1:-1, :] = tau

    # --- CONDICIONES DE FRONTERA ---
    v_new[0, :] = 0
    v_new[-1, :] = 0
    u_new[0, :] = -0.5
    u_new[-1, :] = 1.0
    u_new[:, -1] = u_new[:, -2]
    p_new[:, 0] = p_new[:, 1]
    p_new[:, -1] = p_new[:, -2]
    p_new[0, :] = p_new[1, :]
    p_new[-1, :] = p_new[-2, :]
    T_new[0, :] = 0.0
    T_new[-1, :] = 0.0

    return u_new, v_new, p_new, T_new, tau_full


#===============================================================

def run_simulation_gpu(nx=256, ny=256, Re=20.0, Pr=10.0, Ec=0.1, Eu=1.0,
                       presion_adversa=0.3, nt_steps=None, guardar_hist=False):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # Dominios y pasos
    Lx_star = Ly_star = 1.0
    dx_star = Lx_star / (nx - 1)
    dy_star = Ly_star / (ny - 1)
    dt_cfl = 0.008 * dx_star
    nt = nt_steps if nt_steps else int(torch.ceil(torch.tensor(2.0 / dt_cfl)).item())
    dt_star = 1.0 / nt

    # Malla
    x_star = torch.linspace(0, 1.0, nx, device=device)
    y_star = torch.linspace(0, 1.0, ny, device=device)
    X_star, Y_star = torch.meshgrid(x_star, y_star, indexing='ij')

    # Campos
    u = torch.ones((ny, nx), device=device)
    v = torch.zeros((ny, nx), device=device)
    p = torch.zeros((ny, nx), device=device)
    T = torch.ones((ny, nx), device=device)

    # Condiciones de frontera iniciales
    u[0, :] = -0.5
    u[-1, :] = 1.0
    T[0, :] = 0.0
    T[-1, :] = 0.0

    # Historial
    u_hist, v_hist, p_hist, T_hist, tau_hist = [], [], [], [], []

    def grad_x(f):
        return (torch.roll(f, shifts=-1, dims=1) - torch.roll(f, shifts=1, dims=1)) / (2 * dx_star)
    
    def grad_y(f):
        return (torch.roll(f, shifts=-1, dims=0) - torch.roll(f, shifts=1, dims=0)) / (2 * dy_star)
    
    def laplaciano(f):
        return (
            (torch.roll(f, shifts=1, dims=1) - 2 * f + torch.roll(f, shifts=-1, dims=1)) / dx_star**2 +
            (torch.roll(f, shifts=1, dims=0) - 2 * f + torch.roll(f, shifts=-1, dims=0)) / dy_star**2
        )

    for n in range(nt):
        # Guardar estados previos
        u_old = u.clone()
        v_old = v.clone()
        T_old = T.clone()
        p_old = p.clone()

        # Términos convectivos
        conv_u = u_old * grad_x(u_old) + v_old * grad_y(u_old)
        conv_v = u_old * grad_x(v_old) + v_old * grad_y(v_old)
        conv_T = u_old * grad_x(T_old) + v_old * grad_y(T_old)

        # Difusión
        diff_u = laplaciano(u_old)
        diff_v = laplaciano(v_old)
        diff_T = laplaciano(T_old)

        # Presión y fuerzas
        grad_py = grad_y(p_old)

        u = u - dt_star * (conv_u - (1/Re) * diff_u)
        v = v - dt_star * (conv_v + Eu * grad_py - (1/Re) * diff_v)

        # Presión controlada en entrada
        x_mask = X_star <= 0.3
        p += (x_mask * 0.01 + (~x_mask) * presion_adversa * (X_star - 0.3)) * dt_star

        # Actualización de velocidad por gradiente de presión
        grad_px = grad_x(p)
        grad_py = grad_y(p)
        u -= dt_star * Eu * grad_px
        v -= dt_star * Eu * grad_py

        # Temperatura
        Sxx = grad_x(u)
        Syy = grad_y(v)
        Sxy = 0.5 * (grad_y(u) + grad_x(v))
        viscous_heating = (Ec / Re) * (2 * (Sxx**2 + Syy**2) + 4 * Sxy**2)
        T = T - dt_star * conv_T + dt_star * ((1/(Re*Pr)) * diff_T + viscous_heating)

        # Esfuerzo cortante (shear)
        tau = grad_y(u)

        # Condiciones de frontera (igual que antes)
        u[0, :] = -0.5
        u[-1, :] = 1.0
        v[0, :] = 0.0
        v[-1, :] = 0.0
        u[:, -1] = u[:, -2]
        p[:, 0] = p[:, 1]
        p[:, -1] = p[:, -2]
        p[0, :] = p[1, :]
        p[-1, :] = p[-2, :]
        T[0, :] = 0.0
        T[-1, :] = 0.0

        if guardar_hist and (n % (nt // 10) == 0 or n == nt - 1):
            u_hist.append(u.detach().cpu().numpy())
            v_hist.append(v.detach().cpu().numpy())
            p_hist.append(p.detach().cpu().numpy())
            T_hist.append(T.detach().cpu().numpy())
            tau_hist.append(tau.detach().cpu().numpy())

    return {
        "u_history": u_hist,
        "v_history": v_hist,
        "p_history": p_hist,
        "T_history": T_hist,
        "tau_history": tau_hist,
        "params": {
            "nx": nx, "ny": ny, "dt_star": dt_star, "nt": nt,
            "presion_adversa": presion_adversa, "Re": Re, "Pr": Pr, "Ec": Ec, "Eu": Eu
        },
        "X_star": X_star.detach().cpu().numpy(),
        "Y_star": Y_star.detach().cpu().numpy(),
    }


#===============================================================

import pickle
import os

def guardar_resultado(sim_data, nx, ny, folder='sim_gpu'):
    os.makedirs(folder, exist_ok=True)
    archivo = os.path.join(folder, f"{nx}x{ny}.pkl")
    with open(archivo, 'wb') as f:
        pickle.dump(sim_data, f)
    print(f"📁 Resultado guardado en: {archivo}")

#===============================================================

import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, FFMpegWriter

def animar_resultados(sim_data):
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

    fig.suptitle(f"Resolución {resolucion}x{resolucion} | presión_adversa = {presion_adversa} | t* = 0.00", fontsize=14)
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

#===============================================================

resoluciones = [25, 50]
carpeta_sim = 'sim_gpu'
carpeta_anim = 'anim_gpu'

os.makedirs(carpeta_sim, exist_ok=True)
os.makedirs(carpeta_anim, exist_ok=True)

for res in resoluciones:
    print(f"\n🔄 Simulando resolución {res}x{res}...")
    sim = run_simulation_gpu(nx=res, ny=res, guardar_hist=True)
    guardar_resultado(sim, res, res, carpeta_sim)

    print(f"🎞️ Generando animación {res}x{res}...")
    anim, fig = animar_resultados(sim)
    salida = os.path.join(carpeta_anim, f"{res}x{res}.mp4")
    anim.save(salida, writer=FFMpegWriter(fps=30))
    plt.close(fig)

    print(f"✅ Animación guardada en: {salida}")
