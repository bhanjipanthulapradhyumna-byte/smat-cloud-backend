% Contour map and mesh surface
clc; clear; close all;
[X,Y] = meshgrid(-2:0.05:2);
Z = X.^2 - Y.^2;
contour(X,Y,Z,20); grid on;
title('Contour map: z = x^2 - y^2'); xlabel('x'); ylabel('y');
figure;
mesh(X,Y,Z);
title('Mesh: saddle surface'); xlabel('x'); ylabel('y'); zlabel('z');
