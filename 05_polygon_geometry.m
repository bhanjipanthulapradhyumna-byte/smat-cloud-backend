% Regular hexagon geometry
clc; clear; close all;
n = 6; r = 3;
theta = linspace(0,2*pi,n+1);
x = r*cos(theta); y = r*sin(theta);
plot(x,y,'-o','LineWidth',1.5); axis equal; grid on;
title('Regular hexagon'); xlabel('x'); ylabel('y');
side = 2*r*sin(pi/n);
fprintf('Sides = %d, side length = %.4f, perimeter = %.4f\n', n, side, n*side);
