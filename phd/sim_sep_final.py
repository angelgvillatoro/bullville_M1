
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
                np.save(os.path.join(frame_folder, f"T_{n:05d}.npy"), T_star)
                np.save(os.path.join(frame_folder, f"tau_{n:05d}.npy"), tau)
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
            "presion_adversa": presion_adversa
        },
        "X_star": X_star,
        "Y_star": Y_star,
        "frame_folder": frame_folder if guardar_en_disco else None,
    }

#============================================================================================================

def reconstruir_sim_data(folder_base, resolucion, destino_pkl, plantilla_params=None):
    frame_folder = os.path.join(folder_base, f"{resolucion}x{resolucion}_frames")
    if not os.path.isdir(frame_folder):
        raise FileNotFoundError(f"No se encontró la carpeta de frames: {frame_folder}")

    print(f"📂 Cargando frames desde: {frame_folder}")

    # Detectar todos los archivos u_*.npy
    archivos = sorted([f for f in os.listdir(frame_folder) if f.startswith("u_") and f.endswith(".npy")])
    n_frames = len(archivos)
    if n_frames == 0:
        raise ValueError("No se encontraron archivos u_*.npy")

    u_history = []
    v_history = []
    p_history = []
    T_history = []
    tau_history = []

    for archivo_u in archivos:
        n = int(archivo_u.split('_')[1].split('.')[0])
        archivo_v = f"v_{n:05d}.npy"
        archivo_p = f"p_{n:05d}.npy"
        
        u = np.load(os.path.join(frame_folder, archivo_u))
        v = np.load(os.path.join(frame_folder, archivo_v))
        p = np.load(os.path.join(frame_folder, archivo_p))
        
        # Inicializa campos constantes
        if len(u_history) == 0:
            ny, nx = u.shape
            x_star = np.linspace(0, 1.0, nx)
            y_star = np.linspace(0, 1.0, ny)
            X_star, Y_star = np.meshgrid(x_star, y_star)
            T = np.ones_like(u)
            tau = np.zeros_like(u)
        
        u_history.append(u)
        v_history.append(v)
        p_history.append(p)
        T_history.append(T.copy())
        tau_history.append(tau.copy())

    # Parámetros estimados o copiados
    if plantilla_params:
        with open(plantilla_params, 'rb') as f:
            base_params = pickle.load(f)["params"]
        dt_star = base_params["dt_star"]
        presion_adversa = base_params.get("presion_adversa", 0.3)
    else:
        dt_star = 1.0 / (n_frames - 1)
        presion_adversa = 0.2

    sim_data = {
        "u_history": u_history,
        "v_history": v_history,
        "p_history": p_history,
        "T_history": T_history,
        "tau_history": tau_history,
        "params": {
            "nx": nx, "ny": ny, "dt_star": dt_star, "nt": n_frames,
            "presion_adversa": presion_adversa
        },
        "X_star": X_star,
        "Y_star": Y_star,
        "frame_folder": frame_folder
    }

    # Guardar .pkl final
    os.makedirs(destino_pkl, exist_ok=True)
    archivo_pkl = os.path.join(destino_pkl, f"{resolucion}x{resolucion}.pkl")
    with open(archivo_pkl, 'wb') as f:
        pickle.dump(sim_data, f)

    print(f"✅ Archivo .pkl creado: {archivo_pkl}")


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


# --- GUARDADO DE RESULTADOS ---
def guardar_resultado(sim_data, nx, ny, folder):
    os.makedirs(folder, exist_ok=True)
    archivo = os.path.join(folder, f"{nx}x{ny}.pkl")
    with open(archivo, 'wb') as f:
        pickle.dump(sim_data, f)
    print(f"📁 Resultado guardado en {archivo}")


from matplotlib.animation import FFMpegWriter
import os
import pickle

resoluciones = [25]
coef_presion = 0.2
carpeta_sim = 'sim_separacion'
carpeta_anim = "anim_sep_bubble"
plantilla_param = os.path.join(carpeta_sim, "400x400.pkl")  # base para dt_star y p_adversa

if __name__ == "__main__":
    os.makedirs(carpeta_sim, exist_ok=True)
    os.makedirs(carpeta_anim, exist_ok=True)

    for size in resoluciones:
        print(f"🔄 Procesando resolución {size}x{size}...")

        if size < 2000:
            # --- Resoluciones bajas: simular y guardar directamente ---
            sim = run_simulation_separacion(
                size, size,
                guardar_en_disco=False,
                presion_adversa=coef_presion
            )
            guardar_resultado(sim, size, size, carpeta_sim)

        else:
            # --- Resoluciones altas: simular guardando frames, luego reconstruir ---
            sim = run_simulation_separacion(
                size, size,
                guardar_en_disco=True,
                presion_adversa=coef_presion
            )
            # Reconstruir el .pkl desde los .npy
            reconstruir_sim_data(
                carpeta_sim,
                size,
                carpeta_sim,
                plantilla_params=plantilla_param
            )

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
