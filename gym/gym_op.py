import pandas as pd
from datetime import date
import numpy as np

# Lectura de archivos CSV
a = pd.read_csv(
    "C:/Users/an199/OneDrive/pegos/gym/plantillas/a_porcentajes_nuevo.csv",
    index_col=0,
)
a_rep = pd.read_csv(
    "C:/Users/an199/OneDrive/pegos/gym/plantillas/a_rep_nuevo.csv",
    index_col=0,
)
b = pd.read_csv(
    "/Users/bullville/Library/CloudStorage/OneDrive-Personal/pegos/gym/plantillas/planB_plantilla.csv",
    index_col=0,
)
b_rep = pd.read_csv(
    "/Users/bullville/Library/CloudStorage/OneDrive-Personal/pegos/gym/plantillas/repB.csv",
    index_col=0,
)
rm = pd.read_csv(
    "/Users/bullville/Library/CloudStorage/OneDrive-Personal/pegos/gym/plantillas/rm.csv", index_col=0
)

# Conversión de índices a strings
a.index = a.index.astype(str)
b.index = b.index.astype(str)
rm.index = rm.index.astype(str)

# Conversión de columnas de rm a fechas
rm.columns = pd.to_datetime(rm.columns)

# Creación de DataFrames vacíos
A_new = pd.DataFrame()
B_new = pd.DataFrame()

# Iteración sobre los índices de rm
for i in range(len(rm)):
    # PLAN A
    if 0 <= i < 6:
        if rm.index[i] == "roller":
            row1 = (
                a[a.index.str.contains(rm.index[i])] * rm.iloc[i, len(rm.columns) - 1]
            )
            row2 = a_rep[a_rep.index.str.contains(rm.index[i])]
            A_new = pd.concat([A_new, row1 + row2])
        else:
            row1 = (
                a[a.index.str.contains(rm.index[i])] * rm.iloc[i, len(rm.columns) - 1]
            ) + 2.5
            row2 = a_rep[a_rep.index.str.contains(rm.index[i])]
            round = (row1 / 2.5).round(0)
            row1 = round * 2.5
            A_new = pd.concat([A_new, row1, row2])
    # PLAN B
    else:
        if rm.index[i] == "roller_b":
            row1 = (
                b[b.index.str.contains(rm.index[i])] * rm.iloc[i, len(rm.columns) - 1]
            )
            row2 = b_rep[b_rep.index.str.contains(rm.index[i])]
            B_new = pd.concat([B_new, row1 + row2])
        elif rm.index[i] == ("curl_nordico"):
            r1 = []
            r2 = []
            r_m = rm.iloc[i, len(rm.columns) - 1]
            rep = rm.iloc[i + 1, len(rm.columns) - 1]
            j = 0
            while j < 15:
                if rep < 12:
                    for c in range(4):
                        if j < 15:
                            r1.append(r_m)
                            r2.append(rep)
                            j = j + 1
                    rep = rep + 1
                else:
                    r_m = r_m + 2.5
                    rep = 5
                    for c in range(4):
                        if j < 15:
                            r1.append(r_m)
                            r2.append(rep)
                            j = j + 1
                    rep = rep + 1
            r1 = pd.DataFrame(r1, index=B_new.columns, columns=["curl_nordico"])
            r2 = pd.DataFrame(r2, index=B_new.columns, columns=["curl_nordico_rep"])
            r1 = r1.transpose()
            r2 = r2.transpose()
            B_new = pd.concat([B_new, r1, r2])
        elif (
            (rm.index[i] == "muscle_up_1")
            | (rm.index[i] == "muscle_up_2")
            | (rm.index[i] == "muscle_up_3")
            | (rm.index[i] == "muscle_up_4")
        ):
            row = (
                b_rep[b_rep.index.str.contains(rm.index[i])]
                + rm.iloc[i, len(rm.columns) - 1]
            )
            B_new = pd.concat([B_new, row])
        elif rm.index[i] == "pull_up":
            row1 = b[b.index.str.contains(rm.index[i])] * (
                rm.iloc[i, len(rm.columns) - 1] - 82
            )
            row2 = b_rep[b_rep.index.str.contains(rm.index[i])]
            round = (row1 / 2.5).round(0)
            row1 = round * 2.5
            B_new = pd.concat([B_new, row1, row2])
        else:
            row1 = (
                b[b.index.str.contains(rm.index[i])] * rm.iloc[i, len(rm.columns) - 1]
            )
            row2 = b_rep[b_rep.index.str.contains(rm.index[i])]
            round = (row1 / 2.5).round(0)
            row1 = round * 2.5
            B_new = pd.concat([B_new, row1, row2])

# Creación de DataFrame para rm
new_rm = pd.DataFrame([A_new.loc["roller"].iloc[-1]], index=rm.index)

# Escritura en archivo CSV
rm[date.today()] = new_rm
rm.to_csv("C:/Users/an199/OneDrive/Desktop/pegos/gym/plantillas/rm.csv")

# Escritura en archivos CSV y Excel
file_a = "C:/Users/an199/OneDrive/Desktop/pegos/gym/planes/A_" + str(date.today())
file_b = "C:/Users/an199/OneDrive/Desktop/pegos/gym/planes/B_" + str(date.today())
file_ap = (
    "C:/Users/an199/OneDrive/Desktop/pegos/gym/planes/A_" + str(date.today()) + ".xlsx"
)
file_bp = (
    "C:/Users/an199/OneDrive/Desktop/pegos/gym/planes/B_" + str(date.today()) + ".xlsx"
)
A_new.to_csv(file_a)
B_new.to_csv(file_b)
A_new.to_excel(file_ap)
B_new.to_excel(file_bp)
