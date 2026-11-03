# 津波浸水想定（宮崎県・南トラR7・10mメッシュ）から、指定した地点の最大浸水深を読み取る。
# データ（約250MB）はリポジトリに入れない。https://data.bodik.jp/dataset/450006_1081 から r7_shinsui.zip を取って展開しておく。
# 使い方：python3 scripts/tsunami-depth.py <展開したフォルダ> '[["宿",31.8030,131.4690]]'
# 座標は平面直角座標系 第II系（原点 北緯33度・東経131度）。換算は国土地理院の計算式（検算例と一致を確認済み）。
import struct, math, sys, json
a=6378137.0; F=298.257222101; n=1/(2*F-1)
def tm(lat,lng,lat0=33.0,lng0=131.0,m0=0.9999):
    # ガウス・クリューゲル（国土地理院の計算式）
    A=[1+n**2/4+n**4/64, -3/2*(n-n**3/8), 15/16*(n**2-n**4/4), -35/48*n**3, 315/512*n**4]
    al=[None, n/2-2/3*n**2+5/16*n**3, 13/48*n**2-3/5*n**3, 61/240*n**3]
    Abar=m0*a/(1+n)*A[0]
    def S(phi): return m0*a/(1+n)*(A[0]*phi+sum(A[j]*math.sin(2*j*phi) for j in range(1,5)))
    p=math.radians(lat); l=math.radians(lng-lng0)
    t=math.sinh(math.atanh(math.sin(p))-2*math.sqrt(n)/(1+n)*math.atanh(2*math.sqrt(n)/(1+n)*math.sin(p)))
    tb=math.sqrt(1+t*t); xi=math.atan(t/math.cos(l)); eta=math.atanh(math.sin(l)/tb)
    x=Abar*(xi+sum(al[j]*math.sin(2*j*xi)*math.cosh(2*j*eta) for j in range(1,4)))-S(math.radians(lat0))
    y=Abar*(eta+sum(al[j]*math.cos(2*j*xi)*math.sinh(2*j*eta) for j in range(1,4)))
    return x,y  # x=北, y=東
def pip(px,py,pts):
    c=False;j=len(pts)-1
    for i in range(len(pts)):
        xi,yi=pts[i];xj,yj=pts[j]
        if (yi>py)!=(yj>py) and px<(xj-xi)*(py-yi)/(yj-yi)+xi: c=not c
        j=i
    return c
def main(d,points):
    targets=[(name,)+tm(lat,lng) for name,lat,lng in points]  # (name, N, E)
    res={t[0]:None for t in targets}
    shx=open(d+'/shinsui.shx','rb').read(); shp=open(d+'/shinsui.shp','rb')
    dbf=open(d+'/shinsui.dbf','rb'); h=dbf.read(32); nrec,hl,rl=struct.unpack('<IHH',h[4:12])
    nrec_shx=(len(shx)-100)//8
    for i in range(nrec_shx):
        off,ln=struct.unpack('>ii',shx[100+i*8:108+i*8])
        shp.seek(off*2+8); b=shp.read(ln*2)
        xmin,ymin,xmax,ymax=struct.unpack('<4d',b[4:36])  # x=東, y=北
        for name,N,E in targets:
            if res[name] is None and xmin<=E<=xmax and ymin<=N<=ymax:
                npart,npt=struct.unpack('<ii',b[36:44])
                pts=[struct.unpack('<2d',b[44+4*npart+16*k:60+4*npart+16*k]) for k in range(npt)]
                if pip(E,N,pts):
                    dbf.seek(hl+i*rl); r=dbf.read(rl)
                    res[name]=float(r[23:33])
    return res
if __name__=='__main__':
    pts=json.loads(sys.argv[2])
    print(json.dumps(main(sys.argv[1],pts),ensure_ascii=False,indent=1))
