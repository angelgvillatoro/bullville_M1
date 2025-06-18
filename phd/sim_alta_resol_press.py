
import numpy as np
import os
import pickle
import sys
from numba import njit, prange
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation,FFMpegWriter
from IPython.display import HTML


@njit(parallel=True, fastmath=True)
def actualizar_campos(presion_adversa, u_old, v_old, p_old, T_old, u_star, v_star, p_star, T_star,
                      Re, Pr, Ec, Eu, dt_star, dx_star, dy_star, nx, ny):
    for i in prange(1, ny - 1):
        for j in prange(1, nx - 1):
            conv_u_x = u_old[i, j] * (u_old[i, j + 1] - u_old[i, j - 1]) / (2 * dx_star)
            conv_u_y = v_old[i, j] * (u_old[i + 1, j] - u_old[i - 1, j]) / (2 * dy_star)
            diff_u_x = (u_old[i, j + 1] - 2 * u_old[i, j] + u_old[i, j - 1]) / dx_star**2
            diff_u_y = (u_old[i + 1, j] - 2 * u_old[i, j] + u_old[i - 1, j]) / dy_star**2
            u_star[i, j] += dt_star * (-conv_u_x - conv_u_y + (1 / Re) * (diff_u_x + diff_u_y))

            conv_v_x = u_old[i, j] * (v_old[i, j + 1] - v_old[i, j - 1]) / (2 * dx_star)
            conv_v_y = v_old[i, j] * (v_old[i + 1, j] - v_old[i - 1, j]) / (2 * dy_star)
            diff_v_x = (v_old[i, j + 1] - 2 * v_old[i, j] + v_old[i, j - 1]) / dx_star**2
            diff_v_y = (v_old[i + 1, j] - 2 * v_old[i, j] + v_old[i - 1, j]) / dy_star**2
            grad_p_y = (p_old[i + 1, j] - p_old[i - 1, j]) / (2 * dy_star)
            v_star[i, j] += dt_star * (-conv_v_x - conv_v_y - Eu * grad_p_y + (1 / Re) * (diff_v_x + diff_v_y))

    for _ in range(20):
        for i in prange(1, ny - 1):
            for j in prange(1, nx - 1):
                div = (u_star[i, j + 1] - u_star[i, j - 1]) / (2 * dx_star) + \
                      (v_star[i + 1, j] - v_star[i - 1, j]) / (2 * dy_star)
                p_star[i, j] = 0.25 * (p_old[i + 1, j] + p_old[i - 1, j] +
                                       p_old[i, j + 1] + p_old[i, j - 1] -
                                       (dx_star * dy_star) / (2 * (dx_star**2 + dy_star**2)) * div)
    
    # Gradiente de presión controlado
    for j in prange(nx):
        x = j * dx_star
        for i in prange(ny):
            if x <= 0.3:
                p_star[i, j] += 0.01  # presión constante en entrada
            else:
                p_star[i, j] += presion_adversa * (x - 0.3)


    for i in prange(1, ny - 1):
        for j in prange(1, nx - 1):
            u_star[i, j] -= dt_star * Eu * (p_star[i, j + 1] - p_star[i, j - 1]) / (2 * dx_star)
            v_star[i, j] -= dt_star * Eu * (p_star[i + 1, j] - p_star[i - 1, j]) / (2 * dy_star)

    for i in prange(1, ny - 1):
        for j in prange(1, nx - 1):
            conv_T_x = u_star[i, j] * (T_old[i, j + 1] - T_old[i, j - 1]) / (2 * dx_star)
            conv_T_y = v_star[i, j] * (T_old[i + 1, j] - T_old[i - 1, j]) / (2 * dy_star)
            diff_T_x = (T_old[i, j + 1] - 2 * T_old[i, j] + T_old[i, j - 1]) / dx_star**2
            diff_T_y = (T_old[i + 1, j] - 2 * T_old[i, j] + T_old[i - 1, j]) / dy_star**2
            Sxx = (u_star[i, j + 1] - u_star[i, j - 1]) / (2 * dx_star)
            Syy = (v_star[i + 1, j] - v_star[i - 1, j]) / (2 * dy_star)
            Sxy = 0.5 * ((u_star[i + 1, j] - u_star[i - 1, j]) / (2 * dy_star) +
                         (v_star[i, j + 1] - v_star[i, j - 1]) / (2 * dx_star))
            viscous_heating = (Ec / Re) * (2 * (Sxx**2 + Syy**2) + 4 * Sxy**2)
            T_star[i, j] += dt_star * (-conv_T_x - conv_T_y +
                                       (1 / (Re * Pr)) * (diff_T_x + diff_T_y) +
                                       viscous_heating)

    tau = np.zeros((ny, nx))
    for i in prange(1, ny - 1):
        for j in prange(nx):
            tau[i, j] = (u_star[i + 1, j] - u_star[i - 1, j]) / (2 * dy_star)

# Condiciones de frontera
    v_star[0, :] = 0
    v_star[-1, :] = 0
    u_star[0, :] = -0.5
    u_star[-1, :] = 1.0
    u_star[:, -1] = u_star[:, -2]
    p_star[:, 0] = p_star[:, 1]
    p_star[:, -1] = p_star[:, -2]
    p_star[0, :] = p_star[1, :]
    p_star[-1, :] = p_star[-2, :]

    return u_star, v_star, p_star, T_star, tau

def run_simulation_separacion(nx=25, ny=25, guardar_en_disco=False, folder='sim_separacion', presion_adversa=0.3):
    # Parámetros
    Re, Pr, Ec, Eu = 20.0, 10.0, 0.1, 1.0
    Lx_star = Ly_star = 1.0
    dx_star = Lx_star / (nx - 1)
    dy_star = Ly_star / (ny - 1)
    dt_cfl = 0.008 * dx_star / 1.0
    nt = int(np.ceil(2.0 / dt_cfl))
    dt_star = 1.0 / nt

    # Malla
    x_star = np.linspace(0, Lx_star, nx)
    y_star = np.linspace(0, Ly_star, ny)
    X_star, Y_star = np.meshgrid(x_star, y_star)

    # Campos
    u0, up = 1.0, -1.0
    T0_star, T1_star = 0.0, 0.0
    u_star = np.ones((ny, nx)) * u0
    v_star = np.zeros((ny, nx))
    p_star = np.zeros((ny, nx))
    T_star = np.ones((ny, nx)) * T1_star
    u_star[0, :] = up
    u_star[-1, :] = u0
    T_star[0, :] = T0_star
    T_star[-1, :] = T1_star

    u_hist, v_hist, p_hist, T_hist, tau_hist = [], [], [], [], []

    save_interval = max(1, nt // 300)
    frame_folder = None

    if guardar_en_disco:
        frame_folder = os.path.join(folder, f"{nx}x{ny}_frames")
        os.makedirs(frame_folder, exist_ok=True)

    for n in range(nt):
        u_old, v_old, p_old, T_old = u_star.copy(), v_star.copy(), p_star.copy(), T_star.copy()
        u_star, v_star, p_star, T_star, tau = actualizar_campos(presion_adversa,
            u_old, v_old, p_old, T_old, u_star, v_star, p_star, T_star,
            Re, Pr, Ec, Eu, dt_star, dx_star, dy_star, nx, ny
        )

        if n % save_interval == 0 or n == nt - 1:
            print(f"\rPaso {n}/{nt}", end="")
            if guardar_en_disco:
                np.save(os.path.join(frame_folder, f"u_{n:05d}.npy"), u_star)
                np.save(os.path.join(frame_folder, f"v_{n:05d}.npy"), v_star)
                np.save(os.path.join(frame_folder, f"p_{n:05d}.npy"), p_star)
            else:
                u_hist.append(u_star.copy())
                v_hist.append(v_star.copy())
                p_hist.append(p_star.copy())
                T_hist.append(T_star.copy())
                tau_hist.append(tau.copy())

    print("\n✅ Simulación finalizada.")

    return {
        "u_history": u_hist,
        "v_history": v_hist,
        "p_history": p_hist,
        "T_history": T_hist,
        "tau_history": tau_hist,
        "params": {
            "nx": nx, "ny": ny, "dt_star": dt_star, "nt": nt,
            "presion_adversa": presion_adversa  # <--- aquí
        },
        "X_star": X_star,
        "Y_star": Y_star,
        "frame_folder": frame_folder if guardar_en_disco else None,
    }


# --- ANIMACIÓN DE RESULTADOS ---
# Esta función genera una animación con 4 subgráficas:
# velocidad, temperatura, presión y esfuerzo cortante (tau)
# Destaca contornos de líneas de corriente y temperatura clave para analizar separación

import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
import numpy as np

def animar_resultados_linea(sim_data, vel_level=0.9, temp_level=0.01, alpha_stream=0.4):
    X_star = sim_data["X_star"]
    Y_star = sim_data["Y_star"]
    u_hist = sim_data["u_history"]
    v_hist = sim_data["v_history"]
    p_hist = sim_data["p_history"]
    T_hist = sim_data["T_history"]
    tau_hist = sim_data["tau_history"]
    dt_star = sim_data["params"]["dt_star"]
    presion_adversa = sim_data["params"].get("presion_adversa", "N/A")

    dt_star_visual = 1.0 / len(u_hist)
    fig, axs = plt.subplots(3, 2, figsize=(12, 12))
    ax1, ax2, ax3, ax4, ax5, ax6 = axs.flatten()

    text1 = ax1.text(0.02, 0.95, '', transform=ax1.transAxes, fontsize=9, color='white',
                     bbox=dict(facecolor='black', alpha=0.5))
    text2 = ax2.text(0.02, 0.95, '', transform=ax2.transAxes, fontsize=9, color='white',
                     bbox=dict(facecolor='black', alpha=0.5))

    linea_temp_plot, = ax2.plot([], [], 'k', linewidth=1.5)
    stream_container = []

    def update(frame):
        speed = np.sqrt(u_hist[frame]**2 + v_hist[frame]**2)

        for ax in [ax1, ax2, ax3, ax4, ax5, ax6]:
            while ax.collections:
                ax.collections[-1].remove()

        # Subplot 1: velocidad con streamlines
        cs1 = ax1.contourf(X_star, Y_star, speed, levels=20, cmap='jet')
        ax1.contour(X_star, Y_star, speed, levels=[vel_level], colors='k', linewidths=1.5)
        if stream_container:
            try:
                stream_container[0].lines.remove()
            except ValueError:
                pass
            stream_container.clear()

        stream = ax1.streamplot(X_star, Y_star, u_hist[frame], v_hist[frame],
                        color='white', density=1.2, linewidth=0.8, arrowsize=1)
        stream.lines.set_alpha(alpha_stream)
        stream_container.append(stream)

        # Subplot 2: temperatura
        cs2 = ax2.contour(X_star, Y_star, T_hist[frame], levels=[temp_level], colors='k', linewidths=1.5)
        selected_line = None
        if cs2.allsegs and len(cs2.allsegs[0]) > 0:
            selected_line = np.concatenate(cs2.allsegs[0])
            linea_temp_plot.set_data(selected_line[:, 0], selected_line[:, 1])
        else:
            linea_temp_plot.set_data([], [])
        ax2.contourf(X_star, Y_star, T_hist[frame], levels=20, cmap='jet')

        # Subplot 3: presión
        ax3.contourf(X_star, Y_star, p_hist[frame], levels=20, cmap='viridis')

        # Subplot 4: esfuerzo cortante
        ax4.contourf(X_star, Y_star, tau_hist[frame], levels=20, cmap='coolwarm')

        # Subplot 5: u*
        ax5.contourf(X_star, Y_star, u_hist[frame], levels=20, cmap='plasma')

        # Subplot 6: v*
        ax6.contourf(X_star, Y_star, v_hist[frame], levels=20, cmap='plasma')

        # Textos y títulos
        t_star = frame * dt_star_visual
        ax1.set_title(f'Velocidad |u*| (t*={t_star:.2f})')
        ax2.set_title(f'Temperatura T* (t*={t_star:.2f})')
        ax3.set_title(f'Presión p* (t*={t_star:.2f})')
        ax4.set_title(f'Shear stress τ* (t*={t_star:.2f})')
        ax5.set_title(f'Componente u* (t*={t_star:.2f})')
        ax6.set_title(f'Componente v* (t*={t_star:.2f})')

        text1.set_text(f'|u*|={vel_level} @ x=1\npresión_adversa={presion_adversa}')

        return ax1.collections + ax2.collections + ax3.collections + ax4.collections + ax5.collections + ax6.collections + [text1, text2, linea_temp_plot]

    # --- PRIMER FRAME Y BARRAS DE COLOR ---
    speed0 = np.sqrt(u_hist[0]**2 + v_hist[0]**2)
    cs1 = ax1.contourf(X_star, Y_star, speed0, levels=20, cmap='jet')
    ax1.contour(X_star, Y_star, speed0, levels=[vel_level], colors='k', linewidths=1.5)
    plt.colorbar(cs1, ax=ax1, orientation='vertical', label='|u*|')

    cs2 = ax2.contourf(X_star, Y_star, T_hist[0], levels=20, cmap='jet')
    plt.colorbar(cs2, ax=ax2, orientation='vertical', label='T*')

    cs3 = ax3.contourf(X_star, Y_star, p_hist[0], levels=20, cmap='viridis')
    plt.colorbar(cs3, ax=ax3, orientation='vertical', label='p*')

    cs4 = ax4.contourf(X_star, Y_star, tau_hist[0], levels=20, cmap='coolwarm')
    plt.colorbar(cs4, ax=ax4, orientation='vertical', label='τ*')

    cs5 = ax5.contourf(X_star, Y_star, u_hist[0], levels=20, cmap='plasma')
    plt.colorbar(cs5, ax=ax5, orientation='vertical', label='u*')

    cs6 = ax6.contourf(X_star, Y_star, v_hist[0], levels=20, cmap='plasma')
    plt.colorbar(cs6, ax=ax6, orientation='vertical', label='v*')

    fig.suptitle(f"Resolución {X_star.shape[1]}x{Y_star.shape[0]} | presión_adversa = {presion_adversa}", fontsize=14)
    plt.tight_layout()

    anim = FuncAnimation(fig, update, frames=len(u_hist), interval=100, blit=False)
    return anim, fig

# --- GUARDADO DE RESULTADOS ---
def guardar_resultado(sim_data, nx, ny, folder='sim_separacion'):
    os.makedirs(folder, exist_ok=True)
    archivo = os.path.join(folder, f"{nx}x{ny}.pkl")
    with open(archivo, 'wb') as f:
        pickle.dump(sim_data, f)
    print(f"📁 Resultado guardado en {archivo}")


# --- CICLO DE SIMULACIONES ---
resoluciones = [25, 50, 100, 200, 400, 800, 1600]  # Resoluciones a simular
coef_presion = 0.2  # Presión adversa constante

if __name__ == "__main__":
    for size in resoluciones:
        print(f"🔄 Ejecutando simulación para {size}x{size}...")
        guardar_disco = size >= 800
        sim = run_simulation_separacion(size, size, guardar_en_disco=guardar_disco, presion_adversa = coef_presion)
        if not guardar_disco:
            guardar_resultado(sim, size, size)
'''
# --- EXPORTACIÓN A VIDEO ---
output_folder_linea = 'anim_separacion'
os.makedirs(output_folder_linea, exist_ok=True)

carpeta = 'sim_separacion'

for size in resoluciones:
    nombre = f"{size}x{size}"
    archivo = os.path.join(carpeta, f"{nombre}.pkl")
    if not os.path.exists(archivo):
        print(f"❌ No se encontró: {archivo}")
        continue

    with open(archivo, 'rb') as f:
        sim = pickle.load(f)

    # --- Animación principal con línea de velocidad, streamlines, etc.
    print(f"🎞️ Generando animación de resultados para {nombre}...")
    try:
        anim, fig = animar_resultados_linea(sim, alpha_stream=0.3)
        salida_mp4 = os.path.join(output_folder_linea, f"{nombre}.mp4")

        writer = FFMpegWriter(fps=10, metadata={"title": nombre})
        anim.save(salida_mp4, writer=writer)
        plt.close(fig)
        print(f"✅ Guardado: {salida_mp4}")
    except Exception as e:
        print(f"⚠️ Error al animar resultados línea {nombre}: {e}")'''