
import numpy as np
import os
import pickle
import gzip
from numba import njit, prange

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

    for j in prange(nx):
        x = j * dx_star
        for i in prange(ny):
            if x <= 0.3:
                p_star[i, j] += 0.01
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

    tau = np.zeros((ny, nx), dtype=np.float32)
    for i in prange(1, ny - 1):
        for j in prange(nx):
            tau[i, j] = (u_star[i + 1, j] - u_star[i - 1, j]) / (2 * dy_star)

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

# ========================================================================

def simular_chunk(nx, ny, nt_chunk, dt_star, start_n, presion_adversa):
    u = np.ones((ny, nx), dtype=np.float32)
    v = np.zeros((ny, nx), dtype=np.float32)
    p = np.zeros((ny, nx), dtype=np.float32)
    T = np.ones((ny, nx), dtype=np.float32)
    u[0, :] = -0.5
    u[-1, :] = 1.0
    T[0, :] = T[-1, :] = 0.0

    dx_star = 1.0 / (nx - 1)
    dy_star = 1.0 / (ny - 1)
    Re, Pr, Ec, Eu = 20.0, 10.0, 0.1, 1.0

    u_hist, v_hist, p_hist, T_hist, tau_hist = [], [], [], [], []

    for step in range(nt_chunk):
        u_old, v_old, p_old, T_old = u.copy(), v.copy(), p.copy(), T.copy()
        u, v, p, T, tau = actualizar_campos(presion_adversa, u_old, v_old, p_old, T_old, u, v, p, T,
                                            Re, Pr, Ec, Eu, dt_star, dx_star, dy_star, nx, ny)
        u_hist.append(u.copy())
        v_hist.append(v.copy())
        p_hist.append(p.copy())
        T_hist.append(T.copy())
        tau_hist.append(tau.copy())
        print(f"\r⏱ Paso global {start_n + step + 1}/300", end="")

    return u_hist, v_hist, p_hist, T_hist, tau_hist

# ========================================================================

def reconstruir_chunks(folder, nx, ny):
    chunks = sorted([f for f in os.listdir(folder) if f.endswith(".pkl.gz")])
    u_hist, v_hist, p_hist, T_hist, tau_hist = [], [], [], [], []

    for f_name in chunks:
        with gzip.open(os.path.join(folder, f_name), "rb") as f:
            data = pickle.load(f)
        u_hist.extend(data["u"])
        v_hist.extend(data["v"])
        p_hist.extend(data["p"])
        T_hist.extend(data["T"])
        tau_hist.extend(data["tau"])

    x_star = np.linspace(0, 1.0, nx)
    y_star = np.linspace(0, 1.0, ny)
    X_star, Y_star = np.meshgrid(x_star, y_star)

    return {
        "u_history": u_hist,
        "v_history": v_hist,
        "p_history": p_hist,
        "T_history": T_hist,
        "tau_history": tau_hist,
        "params": {
            "nx": nx, "ny": ny, "dt_star": 1.0 / len(u_hist), "nt": len(u_hist),
            "presion_adversa": 0.3
        },
        "X_star": X_star,
        "Y_star": Y_star
    }

# ========================================================================

def run_and_store_chunks(nx=1600, ny=1600, nt_total=300, chunk_size=100, folder="sim_sep_chunks_1600", presion_adversa=0.3):
    dt_star = 1.0 / nt_total
    os.makedirs(folder, exist_ok=True)

    for i in range(0, nt_total, chunk_size):
        u_hist, v_hist, p_hist, T_hist, tau_hist = simular_chunk(
            nx, ny, chunk_size, dt_star, i, presion_adversa
        )
        data = {
            "u": u_hist,
            "v": v_hist,
            "p": p_hist,
            "T": T_hist,
            "tau": tau_hist,
        }
        chunk_file = os.path.join(folder, f"chunk_{i//chunk_size}.pkl.gz")
        with gzip.open(chunk_file, "wb") as f:
            pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)

    print("\n✅ Chunks individuales guardados.")

    sim_data = reconstruir_chunks(folder, nx, ny)
    output_path = os.path.join(folder, f"{nx}x{ny}_300frames.pkl.gz")
    with gzip.open(output_path, "wb") as f:
        pickle.dump(sim_data, f, protocol=pickle.HIGHEST_PROTOCOL)
    print(f"✅ Archivo final consolidado guardado en: {output_path}")

# ========================================================================

if __name__ == "__main__":
    run_and_store_chunks()
