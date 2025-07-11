import numpy as np
import os
import pickle
import sys
from numba import njit, prange
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation,FFMpegWriter
from IPython.display import HTML

# --- ANIMACIÓN DE RESULTADOS ---
# Esta función genera una animación con 4 subgráficas:
# velocidad, temperatura, presión y esfuerzo cortante (tau)
# Destaca contornos de líneas de corriente y temperatura clave para analizar separación

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

    # Primer frame
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

resoluciones = [25,50, 100, 200, 400, 800]
coef_presion = 0.2
carpeta_sim = 'sim_separacion'
carpeta_anim = "anim_sep_2"

if __name__ == "__main__":
    os.makedirs(carpeta_sim, exist_ok=True)
    os.makedirs(carpeta_anim, exist_ok=True)

    for size in resoluciones:
        print(f"🔄 Procesando resolución {size}x{size}...")

        # Cargar el .pkl recién creado
        archivo_pkl = os.path.join(carpeta_sim, f"{size}x{size}.pkl")
        with open(archivo_pkl, 'rb') as f:
            sim = pickle.load(f)

        # --- Generar animación ---
        print(f"🎞️ Generando animación para {size}x{size}...")
        anim, fig = animar_resultados(sim)

        salida = os.path.join(carpeta_anim, f"{size}x{size}.mp4")
        writer = FFMpegWriter(fps=30)
        anim.save(salida, writer=writer)
        plt.close(fig)

        print(f"✅ Animación guardada en: {salida}")